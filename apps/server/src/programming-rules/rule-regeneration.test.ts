import { afterEach, describe, expect, it } from "vitest";

import { WriteAuthorityBusyError } from "../database/writes/immediate-transaction.js";
import { send } from "../testing/api-requests.js";
import { collectionAssignment } from "../testing/assignment-bodies.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { assignmentFixture } from "../testing/channel-fixtures.js";
import { manualClock, type ManualClock } from "../testing/manual-clock.js";
import {
  openRacingSchedule,
  racingRegenerator,
} from "../testing/racing-schedule.js";
import { sequentialIds } from "../testing/record-sources.js";
import { recordingLog } from "../testing/recording-log.js";
import {
  insertCollectionOfItems,
  readBlocks,
  readOnlyScheduleState,
  readScheduleEntries,
  seedScheduleScenario,
} from "../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../testing/schedule-server.js";
import { createBarrier } from "../testing/test-barrier.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  startTestServer,
} from "../testing/test-environment.js";
import { AssignmentRepository } from "../programming-assignments/persistence/assignment-repository.js";
import { channelInputChange } from "../schedules/channel-input-change.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { ruleChange } from "./rule-change.js";
import { RuleRepository } from "./rule-repository.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = "channel-fixture-001";
const COLLECTION_ID = "collection-fixture-001";
const OFFICE = assignmentFixture.id;
const RULES_URL = `/channels/${CHANNEL_ID}/programming-rules`;

// A join rule over the scenario's assignment, giving it `count` programs a turn.
function resizeRule(count: number, name = "Resize") {
  return {
    name,
    behavior: "join",
    priority: 1,
    sources: [
      {
        assignmentId: OFFICE,
        ordinaryStretch: { kind: "programs", count },
        marathon: { mode: "inherit" },
      },
    ],
  };
}

// The scenario's three-episode turn under a rule that keeps its size,
// airing its first episode.
async function ruledMidTurn() {
  const context = await startScheduleScenarioServer();
  const created = await send(context.server, "POST", RULES_URL, resizeRule(3));
  context.clock.set(T0 + 10 * MINUTE);
  const [turn] = await readBlocks(context.db);
  return {
    ...context,
    turnId: turn?.id,
    ruleUrl: `${RULES_URL}/${created.body.id as string}`,
    ruleId: created.body.id as string,
  };
}

describe("rule edits and the started turn", () => {
  it("leaves a turn whose terms a rule does not change running", async () => {
    const { db, turnId } = await ruledMidTurn();

    // Saving the rule kept the size the turn already had, so it continues.
    const blocks = await readBlocks(db);
    expect(blocks[0]).toMatchObject({ id: turnId, ended_by_edit: 0 });
  });

  it("keeps the airing entry and ends the started turn after it when an edit changes its size", async () => {
    const { server, db, turnId, ruleUrl } = await ruledMidTurn();
    const before = await readScheduleEntries(db, CHANNEL_ID);

    await send(server, "PATCH", ruleUrl, resizeRule(2));

    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]?.programming_block_id).not.toBe(turnId);
    const blocks = await readBlocks(db);
    expect(blocks[0]).toMatchObject({ id: turnId, ended_by_edit: 1 });
    expect(blocks[1]).toMatchObject({ resolved_value: 2 });
  });

  it("keeps the started turn when an edit changes nothing it depends on", async () => {
    const { server, db, turnId, ruleUrl } = await ruledMidTurn();

    await send(server, "PATCH", ruleUrl, resizeRule(3, "Renamed"));

    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(after[1]?.programming_block_id).toBe(turnId);
    await expect(readBlocks(db)).resolves.toContainEqual(
      expect.objectContaining({ id: turnId, ended_by_edit: 0 }),
    );
  });

  it("ends the started turn when a deleted feature gave it its context", async () => {
    const { server, db, clock } = await startScheduleScenarioServer();
    await insertCollectionOfItems(db, "christmas", [90 * MINUTE, 90 * MINUTE]);
    const christmas = await send(
      server,
      "POST",
      `/channels/${CHANNEL_ID}/programming-assignments`,
      {
        ...collectionAssignment("christmas"),
        participation: "rule_only",
        ordinaryStretch: { kind: "programs", count: 2 },
      },
    );
    await send(server, "POST", RULES_URL, {
      name: "Always Christmas",
      behavior: "feature",
      priority: 1,
      sources: [{ assignmentId: christmas.body.id as string }],
    });
    const featured = (await readBlocks(db)).find(
      (block) => block.context_key !== "default",
    );
    expect(featured).toBeDefined();
    // Mid the first film of the featured two-film turn.
    const firstFilm = (await readScheduleEntries(db, CHANNEL_ID)).find(
      (entry) => entry.programming_block_id === featured?.id,
    );
    clock.set((firstFilm?.starts_at ?? 0) + 10 * MINUTE);

    await send(server, "DELETE", `${RULES_URL}/${featured?.winning_rule_id}`);

    const after = await readScheduleEntries(db, CHANNEL_ID);
    const next = after.find((entry) => entry.starts_at === firstFilm?.ends_at);
    expect(next?.programming_block_id).not.toBe(featured?.id);
    await expect(readBlocks(db)).resolves.toContainEqual(
      expect.objectContaining({ id: featured?.id, ended_by_edit: 1 }),
    );
  });

  it("starts fresh rounds and cooldown under the current winner when stopping and rebuilding", async () => {
    const { server, db, ruleId } = await ruledMidTurn();

    const response = await send(
      server,
      "POST",
      `/channels/${CHANNEL_ID}/programming/rebuild`,
      { idempotencyKey: "rebuild-1" },
    );

    expect(response).toMatchObject({ status: 200, body: { rebuilt: true } });
    const fresh = (await readBlocks(db)).filter(
      (block) => block.starts_at >= T0 + 10 * MINUTE,
    );
    expect(fresh[0]).toMatchObject({
      round_number: 1,
      winning_rule_id: ruleId,
      resolved_value: 3,
    });
    expect(JSON.parse(fresh[0]?.checkpoint ?? "{}")).toMatchObject({
      rebuildCount: 1,
      ordinaryRoundsSinceMarathon: null,
    });
  });

  it("acts on the committed edit when a rule edit and an assignment edit race for write authority", async () => {
    const { writer, other, channelId } = await openRacingSchedule();
    const now = FIXTURE_TIME + 30 * MINUTE;
    const barrier = createBarrier();
    const first = racingRegenerator(writer, now, {
      afterBegin: () => barrier.wait(),
    });
    const second = racingRegenerator(other, now, {
      onBusy: () => barrier.release(),
    });
    const createRule = ruleChange(channelId, "created", "UTC", (trx, at) =>
      new RuleRepository(trx, { createId: () => "rule-race" }).create(
        trx,
        channelId,
        {
          ...resizeRule(1),
          behavior: "join",
          dates: { kind: "any" },
          weekdays: null,
          window: null,
          sources: [
            {
              assignmentId: OFFICE,
              ordinaryStretch: { kind: "programs", count: 1 },
              marathon: { mode: "inherit" },
            },
          ],
        },
        at,
      ),
    );
    const editAssignment = channelInputChange(channelId, "updated", (trx, at) =>
      new AssignmentRepository(trx).update(
        trx,
        channelId,
        OFFICE,
        {
          ...collectionAssignment(COLLECTION_ID),
          ordinaryStretch: { kind: "programs", count: 2 },
          members: [{ kind: "collection", mediaCollectionId: COLLECTION_ID }],
        },
        at,
      ),
    );

    const running = first.applyInputChange(
      recordingLog(),
      "rule_created",
      createRule,
    );
    await barrier.reached;
    await Promise.resolve(
      second.applyInputChange(
        recordingLog(),
        "assignment_changed",
        editAssignment,
      ),
    ).catch((error: unknown) => {
      if (!(error instanceof WriteAuthorityBusyError)) throw error;
    });
    barrier.release();
    await running;

    const entries = await readScheduleEntries(writer, channelId);
    expect(new Set(entries.map((entry) => entry.sequence_number)).size).toBe(
      entries.length,
    );
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index]?.starts_at).toBe(entries[index - 1]?.ends_at);
    }
    // The rule changed the started turn's size, so it ended after the airing episode.
    const blocks = await readBlocks(writer);
    expect(blocks[0]?.ended_by_edit).toBe(1);
    expect(blocks[1]).toMatchObject({
      starts_at: FIXTURE_TIME + 60 * MINUTE,
      winning_rule_id: "rule-race",
    });
  });

  it("writes the same programming after a rule edit in any chunk size", async () => {
    const run = async (entriesPerTransaction: number) => {
      const { server, db, clock } = await startScheduleScenarioServer(
        {},
        { entriesPerTransaction },
      );
      const created = await send(server, "POST", RULES_URL, resizeRule(3));
      clock.set(T0 + 10 * MINUTE);
      await send(
        server,
        "PATCH",
        `${RULES_URL}/${created.body.id as string}`,
        resizeRule(2),
      );
      return (await readScheduleEntries(db, CHANNEL_ID)).map((entry) => [
        entry.media_item_id,
        entry.starts_at,
      ]);
    };

    expect(await run(3)).toEqual(await run(500));
  });
});

describe("restarting under another programming timezone", () => {
  // Boots the composition over `dataDirectory` at `clock`, evaluating rules
  // in `timeZone`; the first boot seeds the scenario and, unless told not
  // to, an evening join rule.
  async function boot(
    dataDirectory: string,
    clock: ManualClock,
    timeZone: string,
    name: string,
    seed: "with rule" | "without rule" | null,
  ) {
    const { server, db } = await startTestServer({
      dataDirectory,
      seed: async (db) => {
        if (seed === null) return;
        await seedScheduleScenario(db, {
          items: [22, 23, 24].map((minutes) => ({
            durationMs: minutes * MINUTE,
          })),
          source: "chronological",
        });
      },
      overrides: (db) => ({
        rules: new RuleRepository(db, { createId: sequentialIds("rule") }),
        schedules: new ScheduleService(db, {
          now: clock.now,
          createId: sequentialIds(`${name}-entry`),
          createBlockId: sequentialIds(`${name}-block`),
          programmingTimezone: timeZone,
        }),
      }),
    });
    await server.ready();
    if (seed === "with rule") {
      await send(server, "POST", RULES_URL, {
        ...resizeRule(2),
        window: { startMinute: 18 * 60, endMinute: 20 * 60 },
      });
    }
    return { server, db };
  }

  it("regenerates a channel with rules after its airing entry, once", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const clock = manualClock(T0);
    const first = await boot(dataDirectory, clock, "UTC", "a", "with rule");
    clock.set(T0 + 10 * MINUTE);
    const before = await readScheduleEntries(first.db, CHANNEL_ID);
    const { schedule_revision: revision } = await readOnlyScheduleState(
      first.db,
    );

    const second = await boot(
      dataDirectory,
      clock,
      "America/New_York",
      "b",
      null,
    );

    const after = await readScheduleEntries(second.db, CHANNEL_ID);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]?.id).not.toBe(before[1]?.id);
    const { schedule_revision: changed } = await readOnlyScheduleState(
      second.db,
    );
    expect(changed).toBe(revision + 1);
    expect((await readBlocks(second.db))[0]?.ended_by_edit).toBe(1);

    await boot(dataDirectory, clock, "America/New_York", "c", null);

    await expect(readOnlyScheduleState(second.db)).resolves.toMatchObject({
      schedule_revision: changed,
    });
    await expect(
      second.db
        .selectFrom("server_settings")
        .select("programming_timezone")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ programming_timezone: "America/New_York" });
  });

  it("leaves a channel without rules untouched", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const clock = manualClock(T0);
    const first = await boot(dataDirectory, clock, "UTC", "a", "without rule");
    clock.set(T0 + 10 * MINUTE);
    const before = await readScheduleEntries(first.db, CHANNEL_ID);

    const second = await boot(
      dataDirectory,
      clock,
      "America/New_York",
      "b",
      null,
    );

    // Startup only extends coverage from the later clock; nothing kept changes.
    const after = await readScheduleEntries(second.db, CHANNEL_ID);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(
      (await readBlocks(second.db)).every((block) => block.ended_by_edit === 0),
    ).toBe(true);
  });
});
