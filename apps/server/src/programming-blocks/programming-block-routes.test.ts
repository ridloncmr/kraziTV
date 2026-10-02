import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { send } from "../testing/api-requests.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import {
  seedScheduleScenario,
  readScheduleEntries,
  type ScheduleScenarioOptions,
} from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  startTestServer,
} from "../testing/test-environment.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { ProgrammingBlockRepository } from "./programming-block-repository.js";

afterEach(cleanUpTestEnvironment);

const T0 = FIXTURE_TIME;
const EPISODES = [22, 23, 24].map((minutes) => ({
  durationMs: minutes * 60_000,
}));
// The IDs seedScheduleScenario writes.
const CHANNEL_ID = "channel-fixture-001";
const COLLECTION_ID = "collection-fixture-001";
const ITEM_ID = "item-001";
const BLOCKS_URL = `/channels/${CHANNEL_ID}/programming-blocks`;

const collectionSource = {
  kind: "collection",
  mediaCollectionId: COLLECTION_ID,
  playbackMode: "chronological",
};

// Boots the real composition over a channel with no block yet, with fixed IDs
// and time. A null scenario reopens the data directory without seeding.
async function startServer(
  scenario: Partial<ScheduleScenarioOptions> | null = {},
  dataDirectory?: string,
) {
  const clock = manualClock(T0);
  const { server, db } = await startTestServer({
    dataDirectory,
    seed: async (db) => {
      if (scenario === null) return;
      await seedScheduleScenario(db, {
        items: EPISODES,
        source: null,
        ...scenario,
      });
    },
    overrides: (db) => ({
      programmingBlocks: new ProgrammingBlockRepository(db, {
        createId: () => "block-001",
      }),
      schedules: new ScheduleService(db, { now: clock.now }),
    }),
  });
  return { server, db, clock };
}

describe("programming block routes", () => {
  it("lists no blocks for a channel without programming", async () => {
    const { server } = await startServer();

    await expect(send(server, "GET", BLOCKS_URL)).resolves.toEqual({
      status: 200,
      body: [],
    });
  });

  it("creates a collection block and lists it", async () => {
    const { server } = await startServer();
    const expected = {
      id: "block-001",
      channelId: CHANNEL_ID,
      source: collectionSource,
      createdAt: new Date(T0).toISOString(),
      updatedAt: new Date(T0).toISOString(),
    };

    await expect(
      send(server, "POST", BLOCKS_URL, { source: collectionSource }),
    ).resolves.toEqual({ status: 201, body: expected });
    await expect(send(server, "GET", BLOCKS_URL)).resolves.toEqual({
      status: 200,
      body: [expected],
    });
  });

  it("creates a single-item block", async () => {
    const { server } = await startServer();
    const source = { kind: "media_item", mediaItemId: ITEM_ID };

    const response = await send(server, "POST", BLOCKS_URL, { source });

    expect(response).toMatchObject({ status: 201, body: { source } });
  });

  it.each(["GET", "POST"] as const)(
    "reports an unknown channel on %s",
    async (method) => {
      const { server } = await startServer();

      const response = await send(
        server,
        method,
        "/channels/missing/programming-blocks",
        method === "POST" ? { source: collectionSource } : undefined,
      );

      expect(response).toMatchObject({
        status: 404,
        body: { error: { code: "channel_not_found" } },
      });
    },
  );

  it.each([
    [
      "collection",
      { ...collectionSource, mediaCollectionId: "missing" },
      "media_collection_not_found",
    ],
    [
      "media item",
      { kind: "media_item", mediaItemId: "missing" },
      "media_item_not_found",
    ],
  ])("rejects an unknown %s", async (_, source, code) => {
    const { server, db } = await startServer();

    const response = await send(server, "POST", BLOCKS_URL, { source });

    expect(response).toMatchObject({ status: 400, body: { error: { code } } });
    await expect(
      db.selectFrom("programming_blocks").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it.each([
    ["a missing body source", {}],
    ["a missing source kind", { source: { mediaItemId: ITEM_ID } }],
    [
      "a doubled source",
      { source: { ...collectionSource, mediaItemId: ITEM_ID } },
    ],
    [
      "a mode on an item source",
      {
        source: {
          kind: "media_item",
          mediaItemId: ITEM_ID,
          playbackMode: "random",
        },
      },
    ],
    [
      "a missing mode",
      { source: { kind: "collection", mediaCollectionId: COLLECTION_ID } },
    ],
    [
      "an unsupported mode",
      { source: { ...collectionSource, playbackMode: "shuffle" } },
    ],
    ["an unknown field", { source: collectionSource, name: "Prime time" }],
  ])("rejects %s", async (_, payload) => {
    const { server } = await startServer();

    const response = await send(server, "POST", BLOCKS_URL, payload);

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });

  it("rejects a second block for a channel", async () => {
    const { server } = await startServer();
    await send(server, "POST", BLOCKS_URL, { source: collectionSource });

    const response = await send(server, "POST", BLOCKS_URL, {
      source: { kind: "media_item", mediaItemId: ITEM_ID },
    });

    expect(response).toMatchObject({
      status: 409,
      body: { error: { code: "programming_block_limit_reached" } },
    });
  });

  it("materializes the horizon at revision 1 on an enabled channel", async () => {
    const { server, db } = await startServer();

    await send(server, "POST", BLOCKS_URL, { source: collectionSource });

    const state = await db
      .selectFrom("channel_schedule_states")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(state).toMatchObject({ anchor_time: T0, schedule_revision: 1 });
    expect(state.last_generated_through).toBeGreaterThanOrEqual(
      T0 + SCHEDULE_HORIZON_MS,
    );
    const first = await db
      .selectFrom("schedule_entries")
      .select("starts_at")
      .orderBy("sequence_number")
      .executeTakeFirstOrThrow();
    expect(first.starts_at).toBe(T0);
  });

  it.each([
    ["a disabled channel", { enabled: false }],
    [
      "a source with no schedulable media",
      { items: [{ durationMs: 60_000, status: "missing" as const }] },
    ],
  ])("keeps the block but writes no schedule for %s", async (_, scenario) => {
    const { server, db } = await startServer(scenario);

    const response = await send(server, "POST", BLOCKS_URL, {
      source: collectionSource,
    });

    expect(response.status).toBe(201);
    await expect(
      db.selectFrom("channel_schedule_states").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      db.selectFrom("schedule_entries").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("keeps blocks across a restart", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const first = await startServer({}, dataDirectory);
    const created = await send(first.server, "POST", BLOCKS_URL, {
      source: collectionSource,
    });
    await first.server.close();

    const second = await startServer(null, dataDirectory);

    await expect(send(second.server, "GET", BLOCKS_URL)).resolves.toEqual({
      status: 200,
      body: [created.body],
    });
  });
});

describe("changing and deleting a programming block", () => {
  const BLOCK_URL = `${BLOCKS_URL}/block-001`;
  const randomSource = { ...collectionSource, playbackMode: "random" };

  // Creates the collection block at T0, then moves the clock into the second episode (22–45 minutes).
  async function startScheduled() {
    const context = await startServer();
    await send(context.server, "POST", BLOCKS_URL, {
      source: collectionSource,
    });
    context.clock.set(T0 + 30 * 60_000);
    return context;
  }

  // Reads the channel's entries in sequence order and its revision.
  async function readSchedule(db: Kysely<DatabaseSchema>) {
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    const state = await db
      .selectFrom("channel_schedule_states")
      .select("schedule_revision")
      .executeTakeFirstOrThrow();
    return { entries, revision: state.schedule_revision };
  }

  it("replaces the source and regenerates after the airing entry", async () => {
    const { server, db } = await startScheduled();
    const before = await readSchedule(db);

    const response = await send(server, "PATCH", BLOCK_URL, {
      source: randomSource,
    });

    expect(response).toEqual({
      status: 200,
      body: {
        id: "block-001",
        channelId: CHANNEL_ID,
        source: randomSource,
        createdAt: new Date(T0).toISOString(),
        updatedAt: new Date(T0 + 30 * 60_000).toISOString(),
      },
    });
    const after = await readSchedule(db);
    expect(after.revision).toBe(2);
    expect(after.entries.slice(0, 2)).toEqual(before.entries.slice(0, 2));
    expect(after.entries[2]).toMatchObject({
      starts_at: T0 + 45 * 60_000,
      playback_mode: "random",
    });
  });

  it("writes nothing for an identical source", async () => {
    const { server, db } = await startScheduled();
    const before = await readSchedule(db);

    const response = await send(server, "PATCH", BLOCK_URL, {
      source: collectionSource,
    });

    expect(response).toMatchObject({
      status: 200,
      body: { updatedAt: new Date(T0).toISOString() },
    });
    await expect(readSchedule(db)).resolves.toEqual(before);
  });

  it("deletes the block, keeping the airing entry without it", async () => {
    const { server, db } = await startScheduled();

    const response = await server.inject({ method: "DELETE", url: BLOCK_URL });

    expect(response.statusCode).toBe(204);
    await expect(send(server, "GET", BLOCKS_URL)).resolves.toEqual({
      status: 200,
      body: [],
    });
    const after = await readSchedule(db);
    expect(after.revision).toBe(2);
    expect(
      after.entries.map((entry) => [
        entry.starts_at,
        entry.programming_block_id,
      ]),
    ).toEqual([
      [T0, null],
      [T0 + 22 * 60_000, null],
    ]);
  });

  it.each([
    ["an unknown block", `${BLOCKS_URL}/missing`],
    [
      "another channel's block",
      "/channels/missing/programming-blocks/block-001",
    ],
  ])("reports %s as not found", async (_, url) => {
    const { server } = await startScheduled();

    const patched = await send(server, "PATCH", url, { source: randomSource });
    const deleted = await send(server, "DELETE", url);

    for (const response of [patched, deleted]) {
      expect(response).toMatchObject({
        status: 404,
        body: { error: { code: "programming_block_not_found" } },
      });
    }
  });

  it("rejects an unknown collection and keeps the old source", async () => {
    const { server, db } = await startScheduled();
    const before = await readSchedule(db);

    const response = await send(server, "PATCH", BLOCK_URL, {
      source: { ...collectionSource, mediaCollectionId: "missing" },
    });

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "media_collection_not_found" } },
    });
    await expect(readSchedule(db)).resolves.toEqual(before);
  });

  it("rejects an invalid body", async () => {
    const { server } = await startScheduled();

    const response = await send(server, "PATCH", BLOCK_URL, {
      source: { ...collectionSource, playbackMode: "shuffle" },
    });

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });
});
