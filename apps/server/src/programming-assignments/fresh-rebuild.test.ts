// Programming spec 0004: "Stop it now and rebuild the schedule" gives the
// channel a fresh programming slate and stops its worker after the commit.
import { afterEach, describe, expect, it } from "vitest";

import { send, windowUrl } from "../testing/api-requests.js";
import { collectionAssignment } from "../testing/assignment-bodies.js";
import {
  collectionFixture,
  FIXTURE_TIME,
} from "../testing/catalog-fixtures.js";
import { channelFixture } from "../testing/channel-fixtures.js";
import { RecordingChannelRuntime } from "../testing/recording-channel-runtime.js";
import {
  insertCollectionOfItems,
  readOnlyScheduleState,
  readBlocks,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import {
  startScheduleScenarioServer,
  startScheduleServer,
} from "../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = channelFixture.id;
const COLLECTION_ID = collectionFixture.id;
const REBUILD_URL = `/channels/${CHANNEL_ID}/programming/rebuild`;
const NOW = T0 + 30 * MINUTE;

// Four sources, one program a turn so rounds stay short, airing at NOW.
async function rebuildServer() {
  const started = await startScheduleScenarioServer();
  const { server, db } = started;
  const assignmentsUrl = `/channels/${CHANNEL_ID}/programming-assignments`;
  const assignments = await send(server, "GET", assignmentsUrl);
  await send(server, "PATCH", `${assignmentsUrl}/${assignments.body[0].id}`, {
    ...collectionAssignment(COLLECTION_ID),
    ordinaryStretch: { kind: "programs", count: 1 },
  });
  for (const id of ["parks", "scrubs", "frasier"]) {
    await insertCollectionOfItems(db, id, Array(4).fill(20 * MINUTE));
    await send(server, "POST", assignmentsUrl, {
      ...collectionAssignment(id),
      ordinaryStretch: { kind: "programs", count: 1 },
    });
  }
  started.clock.set(NOW);
  const runtime = started.dependencies
    .channelRuntime as RecordingChannelRuntime;
  return { ...started, runtime };
}

// The assignment order of one round's turns.
function roundOrder(
  blocks: Awaited<ReturnType<typeof readBlocks>>,
  round: number,
) {
  return blocks
    .filter((block) => block.round_number === round)
    .map((block) => block.assignment_id);
}

describe("POST /channels/:id/programming/rebuild", () => {
  it("interrupts the airing program and starts a fresh slate of rounds", async () => {
    const { server, db, runtime } = await rebuildServer();
    const entriesBefore = await readScheduleEntries(db, CHANNEL_ID);
    const blocksBefore = await readBlocks(db);
    const airing = entriesBefore.find(
      (entry) => entry.starts_at <= NOW && entry.ends_at > NOW,
    );
    const assignmentsBefore = await db
      .selectFrom("programming_source_assignments")
      .selectAll()
      .execute();

    const response = await send(server, "POST", REBUILD_URL, {
      idempotencyKey: "rebuild-1",
    });

    expect(response).toEqual({
      status: 200,
      body: { rebuilt: true, stopFailed: false },
    });
    expect(runtime.stops).toEqual([
      expect.objectContaining({ channelId: CHANNEL_ID, reason: "interrupted" }),
    ]);
    await expect(readOnlyScheduleState(db)).resolves.toMatchObject({
      rebuild_count: 1,
      last_rebuild_key: "rebuild-1",
    });
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    // Ended entries stay as history; the airing one is gone.
    expect(entries.filter((entry) => entry.ends_at <= NOW)).toEqual(
      entriesBefore.filter((entry) => entry.ends_at <= NOW),
    );
    expect(entries.map((entry) => entry.id)).not.toContain(airing?.id);
    const fresh = entries.filter((entry) => entry.starts_at >= NOW);
    expect(fresh[0]?.starts_at).toBe(NOW);
    // The interrupted program airs again in its source's next turn.
    expect(
      fresh.find(
        (entry) => entry.media_collection_id === airing?.media_collection_id,
      )?.media_item_id,
    ).toBe(airing?.media_item_id);
    // Every other collection resumes where it was, not at its first program:
    // its next fresh pick is the one the discarded schedule had next.
    for (const id of ["parks", "scrubs", "frasier", COLLECTION_ID]) {
      if (id === airing?.media_collection_id) continue;
      const nextBefore = entriesBefore.find(
        (entry) => entry.media_collection_id === id && entry.starts_at >= NOW,
      );
      expect(
        fresh.find((entry) => entry.media_collection_id === id)?.media_item_id,
      ).toBe(nextBefore?.media_item_id);
    }
    // A fresh round one, under the new rebuild count, with new choices.
    const blocks = await readBlocks(db);
    const firstFresh = blocks.find((block) => block.starts_at >= NOW);
    expect(firstFresh?.round_number).toBe(1);
    expect(JSON.parse(firstFresh?.checkpoint ?? "{}")).toMatchObject({
      rebuildCount: 1,
      contexts: { default: { served: [] } },
      ordinaryRoundsSinceMarathon: null,
    });
    expect(
      roundOrder(
        blocks.filter((block) => block.starts_at >= NOW),
        1,
      ),
    ).not.toEqual(roundOrder(blocksBefore, 1));
    // Configuration stands.
    await expect(
      db.selectFrom("programming_source_assignments").selectAll().execute(),
    ).resolves.toEqual(assignmentsBefore);
  });

  it("advances the rebuild count once for a retried key, and stops the worker again", async () => {
    const { server, db, runtime } = await rebuildServer();
    await send(server, "POST", REBUILD_URL, { idempotencyKey: "rebuild-1" });
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    const state = await readOnlyScheduleState(db);

    const retried = await send(server, "POST", REBUILD_URL, {
      idempotencyKey: "rebuild-1",
    });

    expect(retried).toEqual({
      status: 200,
      body: { rebuilt: false, stopFailed: false },
    });
    await expect(readOnlyScheduleState(db)).resolves.toEqual(state);
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(entries);
    expect(runtime.stops).toHaveLength(2);
    await send(server, "POST", REBUILD_URL, { idempotencyKey: "rebuild-2" });
    await expect(readOnlyScheduleState(db)).resolves.toMatchObject({
      rebuild_count: 2,
    });
  });

  it("reports a worker stop failure for a cleanup retry without rolling the schedule back", async () => {
    const { server, db, runtime } = await rebuildServer();
    runtime.failure = new Error("worker did not stop");

    const response = await send(server, "POST", REBUILD_URL, {
      idempotencyKey: "rebuild-1",
    });

    expect(response).toEqual({
      status: 200,
      body: { rebuilt: true, stopFailed: true },
    });
    await expect(readOnlyScheduleState(db)).resolves.toMatchObject({
      rebuild_count: 1,
    });
    // The rebuilt schedule stands: it airs from now on the fresh slate.
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    expect(entries.filter((entry) => entry.starts_at === NOW)).toHaveLength(1);
  });

  it("remembers the key of a rebuild that created the first schedule, so its retry rebuilds nothing", async () => {
    const { server, db, clock, dependencies } =
      await startScheduleScenarioServer();
    // Boot gives the channel a schedule; clearing it models a boot whose
    // coverage pass failed, the one way a schedulable channel lacks one.
    await db.deleteFrom("schedule_entries").execute();
    await db.deleteFrom("programming_blocks").execute();
    await db.deleteFrom("channel_schedule_states").execute();
    clock.set(NOW);
    const runtime = dependencies.channelRuntime as RecordingChannelRuntime;

    const first = await send(server, "POST", REBUILD_URL, {
      idempotencyKey: "rebuild-1",
    });
    const state = await readOnlyScheduleState(db);
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    const retried = await send(server, "POST", REBUILD_URL, {
      idempotencyKey: "rebuild-1",
    });

    expect(first.body).toEqual({ rebuilt: true, stopFailed: false });
    expect(state).toMatchObject({
      rebuild_count: 0,
      last_rebuild_key: "rebuild-1",
    });
    expect(entries[0]?.starts_at).toBe(NOW);
    expect(retried.body).toEqual({ rebuilt: false, stopFailed: false });
    await expect(readOnlyScheduleState(db)).resolves.toEqual(state);
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(entries);
    expect(runtime.stops).toHaveLength(2);
  });

  it("keeps a rebuild's slate through a restart and later coverage", async () => {
    const { server, db, clock, dataDirectory } = await rebuildServer();
    await send(server, "POST", REBUILD_URL, { idempotencyKey: "rebuild-1" });
    const state = await readOnlyScheduleState(db);
    const blocks = await readBlocks(db);
    await server.close();

    const restarted = await startScheduleServer(dataDirectory, clock, "second");
    await expect(readOnlyScheduleState(restarted.db)).resolves.toEqual(state);
    clock.set(NOW + 2 * 24 * 60 * MINUTE);
    await send(
      restarted.server,
      "GET",
      windowUrl(
        `/channels/${CHANNEL_ID}/schedule`,
        clock.now(),
        clock.now() + 60 * MINUTE,
      ),
    );

    // Coverage continues the rebuilt slate; nothing starts another one.
    await expect(readOnlyScheduleState(restarted.db)).resolves.toMatchObject({
      rebuild_count: 1,
    });
    const extended = await readBlocks(restarted.db);
    expect(extended.slice(0, blocks.length)).toEqual(blocks);
    const added = extended.slice(blocks.length);
    expect(added.length).toBeGreaterThan(0);
    expect(added[0]?.round_number).toBeGreaterThan(1);
    for (const block of added) {
      expect(JSON.parse(block.checkpoint)).toMatchObject({ rebuildCount: 1 });
    }
  });

  it("never advances the rebuild count for previews, coverage, or ordinary regeneration", async () => {
    const { server, db, clock } = await rebuildServer();

    await send(server, "GET", `/channels/${CHANNEL_ID}/programming-preview`);
    await send(server, "POST", `/channels/${CHANNEL_ID}/schedule/generate`, {
      regenerate: true,
    });
    clock.set(NOW + 2 * 24 * 60 * MINUTE);
    await send(
      server,
      "GET",
      windowUrl(
        `/channels/${CHANNEL_ID}/schedule`,
        clock.now(),
        clock.now() + 60 * MINUTE,
      ),
    );

    await expect(readOnlyScheduleState(db)).resolves.toMatchObject({
      rebuild_count: 0,
      last_rebuild_key: null,
    });
  });

  it("refuses an unknown channel and a missing key", async () => {
    const { server } = await rebuildServer();

    await expect(
      send(server, "POST", "/channels/missing/programming/rebuild", {
        idempotencyKey: "rebuild-1",
      }),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "channel_not_found" } },
    });
    await expect(send(server, "POST", REBUILD_URL, {})).resolves.toMatchObject({
      status: 400,
    });
  });
});
