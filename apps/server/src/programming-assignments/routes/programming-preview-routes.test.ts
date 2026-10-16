import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { iso, send } from "../../testing/api-requests.js";
import { collectionAssignment } from "../../testing/assignment-bodies.js";
import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import { insertCollectionOfItems } from "../../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = "channel-fixture-001";
const COLLECTION_ID = "collection-fixture-001";
const ASSIGNMENTS_URL = `/channels/${CHANNEL_ID}/programming-assignments`;
const PREVIEW_URL = `/channels/${CHANNEL_ID}/programming-preview`;

interface ApiTurn {
  assignmentId: string;
  continues: boolean;
  roundNumber: number;
  startsAt: string;
  size: { kind: string; value: number } | null;
  marathon: boolean;
  marathonChancePercent: number | null;
  overrunMinutes: number | null;
  programs: { mediaItemId: string; startsAt: string }[];
}

// Programs the scenario's episodes for an hour a turn beside a parks
// collection of three programs a turn, then moves into the second episode.
async function scheduledServer() {
  const context = await startScheduleScenarioServer({ source: null });
  await insertCollectionOfItems(
    context.db,
    "parks",
    Array(5).fill(30 * MINUTE),
  );
  const office = await send(context.server, "POST", ASSIGNMENTS_URL, {
    ...collectionAssignment(COLLECTION_ID),
    ordinaryStretch: { kind: "airtime", minutes: 60 },
  });
  await send(
    context.server,
    "POST",
    ASSIGNMENTS_URL,
    collectionAssignment("parks"),
  );
  context.clock.set(T0 + 30 * MINUTE);
  return { ...context, officeId: office.body.id as string };
}

// Reads every row a preview could write.
async function readWritableState(db: Kysely<DatabaseSchema>) {
  return {
    entries: await db.selectFrom("schedule_entries").selectAll().execute(),
    blocks: await db.selectFrom("programming_blocks").selectAll().execute(),
    progress: await db
      .selectFrom("channel_collection_progress")
      .selectAll()
      .execute(),
    states: await db
      .selectFrom("channel_schedule_states")
      .selectAll()
      .execute(),
  };
}

// The persisted turns from `from` on, as the preview lists them.
async function persistedTurns(db: Kysely<DatabaseSchema>, from: number) {
  const entries = await db
    .selectFrom("schedule_entries")
    .selectAll()
    .where("channel_id", "=", CHANNEL_ID)
    .where("starts_at", ">=", from)
    .orderBy("starts_at")
    .execute();
  const blockIds = [...new Set(entries.map((e) => e.programming_block_id))];
  return blockIds.map((id) =>
    entries
      .filter((entry) => entry.programming_block_id === id)
      .map((entry) => [entry.media_item_id, iso(entry.starts_at)]),
  );
}

describe("GET /channels/:id/programming-preview", () => {
  it("lists the turns a regeneration then writes, and writes nothing itself", async () => {
    const { server, db } = await scheduledServer();
    const before = await readWritableState(db);

    const preview = await send(server, "GET", `${PREVIEW_URL}?turns=6`);

    expect(preview.status).toBe(200);
    await expect(readWritableState(db)).resolves.toEqual(before);
    const turns = preview.body.turns as ApiTurn[];
    expect(turns).toHaveLength(6);
    const regenerated = await send(
      server,
      "POST",
      `/channels/${CHANNEL_ID}/schedule/generate`,
      { regenerate: true },
    );
    expect(regenerated.status).toBe(200);
    // The airing episode ends 45 minutes in; that is the boundary.
    const written = await persistedTurns(db, T0 + 45 * MINUTE);
    expect(
      turns.map((turn) =>
        turn.programs.map((program) => [program.mediaItemId, program.startsAt]),
      ),
    ).toEqual(written.slice(0, 6));
  });

  it("explains the continued turn, airtime overrun, and round order", async () => {
    const { server, officeId } = await scheduledServer();

    const { body } = await send(server, "GET", PREVIEW_URL);

    const turns = body.turns as ApiTurn[];
    // The airing hour-long turn continues with its third episode.
    expect(turns[0]).toMatchObject({
      assignmentId: officeId,
      continues: true,
      overrunMinutes: null,
      programs: [{ mediaItemId: "item-003" }],
    });
    const nextOffice = turns.find(
      (turn) => !turn.continues && turn.assignmentId === officeId,
    );
    // 22 + 23 + 24 minutes against a 60-minute target runs 9 over.
    expect(nextOffice).toMatchObject({
      size: { kind: "airtime", value: 60 },
      overrunMinutes: 9,
    });
    for (let index = 1; index < turns.length; index += 1) {
      expect(turns[index]?.assignmentId).not.toBe(
        turns[index - 1]?.assignmentId,
      );
    }
  });

  it("names skipped assignments with their reasons and marathons with their chance", async () => {
    const { server, db } = await scheduledServer();
    await insertCollectionOfItems(db, "empty", []);
    await send(server, "POST", ASSIGNMENTS_URL, collectionAssignment("empty"));
    const listed = await send(server, "GET", ASSIGNMENTS_URL);
    const parksId = (listed.body as { id: string }[])[1]?.id ?? "";
    await send(server, "PATCH", `${ASSIGNMENTS_URL}/${parksId}`, {
      ...collectionAssignment("parks"),
      marathonStretch: { kind: "programs", count: 5 },
    });
    await send(server, "PUT", `/channels/${CHANNEL_ID}/programming-settings`, {
      marathonChancePercent: 100,
      marathonMinOrdinaryRounds: 0,
    });

    const { body } = await send(server, "GET", PREVIEW_URL);

    expect(body.skips).toContainEqual(
      expect.objectContaining({ reasons: ["empty_collection"] }),
    );
    expect(body.turns).toContainEqual(
      expect.objectContaining({
        marathon: true,
        marathonChancePercent: 100,
        size: { kind: "programs", value: 5 },
      }),
    );
  });

  it("reports an unknown channel, a channel with nothing to schedule, and a bad turn count", async () => {
    const { server } = await startScheduleScenarioServer({ source: null });

    await expect(
      send(server, "GET", "/channels/missing/programming-preview"),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "channel_not_found" } },
    });
    await expect(send(server, "GET", PREVIEW_URL)).resolves.toMatchObject({
      status: 409,
      body: {
        error: {
          code: "channel_unschedulable",
          reason: "no_programming_assignment",
        },
      },
    });
    await expect(
      send(server, "GET", `${PREVIEW_URL}?turns=0`),
    ).resolves.toMatchObject({ status: 400 });
  });
});

describe("GET /channels/:id/programming-preview: rule decisions", () => {
  const RULES_URL = `/channels/${CHANNEL_ID}/programming-rules`;

  // Adds a rule-only Christmas collection selected by an all-day join rule,
  // ranked below a rule whose only source has nothing to air.
  async function ruledServer() {
    const context = await scheduledServer();
    const { server, db } = context;
    await insertCollectionOfItems(db, "christmas", [90 * MINUTE, 90 * MINUTE]);
    await insertCollectionOfItems(db, "empty", []);
    const ruleOnly = (collection: string) => ({
      ...collectionAssignment(collection),
      participation: "rule_only",
      ordinaryStretch: { kind: "programs", count: 1 },
    });
    const christmas = await send(
      server,
      "POST",
      ASSIGNMENTS_URL,
      ruleOnly("christmas"),
    );
    const empty = await send(
      server,
      "POST",
      ASSIGNMENTS_URL,
      ruleOnly("empty"),
    );
    const rule = (name: string, priority: number, assignmentId: string) =>
      send(server, "POST", RULES_URL, {
        name,
        behavior: "join",
        priority,
        sources: [
          {
            assignmentId,
            ordinaryStretch: { kind: "programs", count: 2 },
            marathon: { mode: "disabled" },
          },
        ],
      });
    const joined = await rule(
      "Always Christmas",
      1,
      christmas.body.id as string,
    );
    const broken = await rule("Nothing to air", 2, empty.body.id as string);
    return {
      ...context,
      christmasId: christmas.body.id as string,
      joinedId: joined.body.id as string,
      brokenId: broken.body.id as string,
    };
  }

  it("names each turn's winning rule, the rules it passed over and why, its decision time, and setting origins", async () => {
    const { server, christmasId, joinedId, brokenId } = await ruledServer();

    const { body } = await send(server, "GET", `${PREVIEW_URL}?turns=8`);

    const fresh = (body.turns as Record<string, unknown>[]).filter(
      (turn) => !turn.continues,
    );
    expect(fresh.length).toBeGreaterThan(4);
    for (const turn of fresh) {
      expect(turn).toMatchObject({
        winningRuleId: joinedId,
        skippedRules: [{ ruleId: brokenId, reason: "no_usable_source" }],
      });
      expect(turn.decidedAt).toBe(turn.startsAt);
    }
    expect(
      fresh.find((turn) => turn.assignmentId === christmasId),
    ).toMatchObject({
      size: { kind: "programs", value: 2 },
      settingOrigins: { ordinary: "rule", marathon: "disabled" },
    });
    expect(
      fresh.find((turn) => turn.assignmentId !== christmasId),
    ).toMatchObject({
      settingOrigins: { ordinary: "assignment", marathon: "assignment" },
    });
  });

  it("matches the rule provenance regeneration then writes", async () => {
    const { server, db } = await ruledServer();
    const { body } = await send(server, "GET", `${PREVIEW_URL}?turns=6`);

    await send(server, "POST", `/channels/${CHANNEL_ID}/schedule/generate`, {
      regenerate: true,
    });

    const written = await db
      .selectFrom("programming_blocks")
      .select(["winning_rule_id", "setting_origins", "assignment_id"])
      .where("starts_at", ">=", T0 + 45 * MINUTE)
      .orderBy("starts_at")
      .execute();
    const fresh = (body.turns as Record<string, unknown>[]).filter(
      (turn) => !turn.continues,
    );
    expect(
      written.slice(0, fresh.length).map((block) => ({
        assignmentId: block.assignment_id,
        winningRuleId: block.winning_rule_id,
        settingOrigins: JSON.parse(block.setting_origins) as unknown,
      })),
    ).toEqual(
      fresh.map(({ assignmentId, winningRuleId, settingOrigins }) => ({
        assignmentId,
        winningRuleId,
        settingOrigins,
      })),
    );
  });

  it("reports the configuration revision, which only configuration writes advance", async () => {
    const { server, db, joinedId } = await ruledServer();
    const revision = async () =>
      (await send(server, "GET", PREVIEW_URL)).body
        .configurationRevision as number;
    const before = await revision();
    const state = await readWritableState(db);

    // Previewing and regenerating change no configuration.
    expect(await revision()).toBe(before);
    await expect(readWritableState(db)).resolves.toEqual(state);
    await send(server, "POST", `/channels/${CHANNEL_ID}/schedule/generate`, {
      regenerate: true,
    });
    expect(await revision()).toBe(before);

    // A progress reset restarts playback; it is not configuration.
    const listed = await send(server, "GET", ASSIGNMENTS_URL);
    const officeId = (listed.body as { id: string }[])[0]?.id ?? "";
    await send(
      server,
      "POST",
      `${ASSIGNMENTS_URL}/${officeId}/progress-reset`,
      {
        mediaCollectionId: COLLECTION_ID,
      },
    );
    expect(await revision()).toBe(before);

    await send(server, "DELETE", `${RULES_URL}/${joinedId}`);

    expect(await revision()).toBe(before + 1);
  });
});
