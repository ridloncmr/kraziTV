import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { send } from "../testing/api-requests.js";
import {
  collectionFixture,
  FIXTURE_TIME,
} from "../testing/catalog-fixtures.js";
import {
  channelFixture,
  collectionProgressFixture,
} from "../testing/channel-fixtures.js";
import { episodeFacts } from "../testing/collection-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import {
  seedScheduleScenario,
  readScheduleEntries,
  type ScheduleScenarioOptions,
} from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
  startTestServer,
} from "../testing/test-environment.js";
import { holdWriteAuthority } from "../testing/hold-write-authority.js";
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
        createId: sequentialIds("block"),
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

  it("answers 503 retryable and creates nothing while another connection holds write authority", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const { server, db } = await startServer({}, dataDirectory);
    const other = await openTestDatabase(dataDirectory);
    const holder = await holdWriteAuthority(other.db);
    try {
      const response = await send(server, "POST", BLOCKS_URL, {
        source: collectionSource,
      });

      expect(response).toMatchObject({
        status: 503,
        body: { error: { code: "schedule_busy", retryable: true } },
      });
    } finally {
      await holder.release();
    }
    await expect(
      db.selectFrom("programming_blocks").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});

describe("playback modes over one collection", () => {
  it("airs saved order on one channel and episode order on another, leaving saved positions alone", async () => {
    // Saved order item-001, item-002, item-003; episode order 3, 1, 2.
    const { server, db } = await startServer();
    await db
      .insertInto("content_facts")
      .values([
        episodeFacts("item-001", 2316, 1, 2),
        episodeFacts("item-002", 2316, 1, 3),
        episodeFacts("item-003", 2316, 1, 1),
      ])
      .execute();
    const other = { ...channelFixture, id: "channel-other", number: "70" };
    await db.insertInto("channels").values(other).execute();
    const positionsBefore = await savedPositions(db);

    await send(server, "POST", BLOCKS_URL, { source: collectionSource });
    const created = await send(
      server,
      "POST",
      `/channels/${other.id}/programming-blocks`,
      { source: { ...collectionSource, playbackMode: "episode" } },
    );

    expect(created).toMatchObject({
      status: 201,
      body: { source: { playbackMode: "episode" } },
    });
    const firstThree = async (channelId: string) =>
      (await readScheduleEntries(db, channelId))
        .slice(0, 3)
        .map((entry) => [entry.media_item_id, entry.playback_mode]);
    await expect(firstThree(CHANNEL_ID)).resolves.toEqual([
      ["item-001", "chronological"],
      ["item-002", "chronological"],
      ["item-003", "chronological"],
    ]);
    await expect(firstThree(other.id)).resolves.toEqual([
      ["item-003", "episode"],
      ["item-001", "episode"],
      ["item-002", "episode"],
    ]);
    await expect(savedPositions(db)).resolves.toEqual(positionsBefore);
  });
});

describe("block preview", () => {
  const PREVIEW_URL = `${BLOCKS_URL}/block-001/preview`;
  // Five members in saved order: Office 1x2, Parks 1x1, Office 1x1, a
  // duplicate Office 1x1, and one with no episode details.
  const MEMBERS = Array.from({ length: 5 }, () => ({
    durationMs: 30 * 60_000,
  }));

  // Starts the server with the five members, their facts, and a block.
  async function previewServer(playbackMode: string) {
    const context = await startServer({ items: MEMBERS });
    await context.db
      .insertInto("content_facts")
      .values([
        episodeFacts("item-001", 2316, 1, 2),
        { ...episodeFacts("item-002", 8592, 1, 1), series_name: "Parks" },
        episodeFacts("item-003", 2316, 1, 1),
        episodeFacts("item-004", 2316, 1, 1),
      ])
      .execute();
    await send(context.server, "POST", BLOCKS_URL, {
      source: { ...collectionSource, playbackMode },
    });
    return context;
  }

  // The preview's ordered members as [item, unresolved, group start, duplicate].
  function flags(body: unknown) {
    return (
      body as {
        ordered: {
          mediaItemId: string;
          unresolved: boolean;
          startsSeriesGroup: boolean;
          duplicateEpisode: boolean;
        }[];
      }
    ).ordered.map((member) => [
      member.mediaItemId,
      member.unresolved,
      member.startsSeriesGroup,
      member.duplicateEpisode,
    ]);
  }

  it("flags unresolved members, series groups, and duplicate episodes", async () => {
    const { server } = await previewServer("episode");

    const response = await send(server, "GET", PREVIEW_URL);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ playbackMode: "episode" });
    expect(flags(response.body)).toEqual([
      ["item-003", false, true, true],
      ["item-004", false, false, true],
      ["item-001", false, false, false],
      ["item-002", false, true, false],
      ["item-005", true, false, false],
    ]);
  });

  it("previews the order the scheduler airs, with the next ten selections", async () => {
    const { server, db } = await previewServer("episode");

    const { body } = await send(server, "GET", PREVIEW_URL);

    const aired = (await readScheduleEntries(db, CHANNEL_ID)).slice(0, 10);
    const preview = body as {
      ordered: { mediaItemId: string }[];
      upcoming: { id: string; mediaItemId: string; startsAt: string }[];
    };
    expect(preview.ordered.map((member) => member.mediaItemId)).toEqual(
      aired.slice(0, 5).map((entry) => entry.media_item_id),
    );
    expect(preview.upcoming).toHaveLength(10);
    expect(preview.upcoming[0]).toEqual({
      id: aired[0]?.id,
      mediaItemId: aired[0]?.media_item_id,
      title: aired[0]?.title,
      startsAt: new Date(T0).toISOString(),
      endsAt: new Date(T0 + 30 * 60_000).toISOString(),
    });
  });

  it("previews an unsaved mode without upcoming selections, and writes nothing", async () => {
    const { server, db } = await previewServer("episode");
    const before = await readScheduleEntries(db, CHANNEL_ID);

    const { body } = await send(
      server,
      "GET",
      `${PREVIEW_URL}?playbackMode=chronological`,
    );

    expect(body).toMatchObject({
      playbackMode: "chronological",
      upcoming: null,
    });
    expect(flags(body).map(([id]) => id)).toEqual([
      "item-001",
      "item-002",
      "item-003",
      "item-004",
      "item-005",
    ]);
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(before);
  });

  it("shows random's upcoming selections without an ordered view", async () => {
    const { server } = await previewServer("random");

    const { body } = await send(server, "GET", PREVIEW_URL);

    expect(body).toMatchObject({ playbackMode: "random", ordered: null });
    expect((body as { upcoming: unknown[] }).upcoming).toHaveLength(10);
  });

  it("refuses a single-item block, an unknown block, and an unknown mode", async () => {
    const { server } = await startServer();
    await send(server, "POST", BLOCKS_URL, {
      source: { kind: "media_item", mediaItemId: ITEM_ID },
    });

    await expect(send(server, "GET", PREVIEW_URL)).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "programming_block_has_no_order" } },
    });
    await expect(
      send(server, "GET", `${BLOCKS_URL}/missing/preview`),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "programming_block_not_found" } },
    });
    await expect(
      send(server, "GET", `${PREVIEW_URL}?playbackMode=shuffle`),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });
});

describe("progress reset", () => {
  const RESET_URL = `${BLOCKS_URL}/block-001/progress-reset`;

  // Plays the three episodes in `playbackMode` from T0, then sets the clock
  // to 30 minutes, while the second entry (item-002) airs.
  async function airingSecondEntry(playbackMode: string) {
    const context = await startServer();
    await send(context.server, "POST", BLOCKS_URL, {
      source: { ...collectionSource, playbackMode },
    });
    context.clock.set(T0 + 30 * 60_000);
    return context;
  }

  // Reads the fixture channel's entries as [item, playback index].
  async function airings(db: Kysely<DatabaseSchema>) {
    return (await readScheduleEntries(db, CHANNEL_ID)).map((entry) => [
      entry.media_item_id,
      entry.playback_index,
    ]);
  }

  it("keeps the airing entry and restarts the collection order after it", async () => {
    const { server, db } = await airingSecondEntry("chronological");
    const [, airing] = await readScheduleEntries(db, CHANNEL_ID);

    const response = await send(server, "POST", RESET_URL);

    expect(response.status).toBe(204);
    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(after[1]).toEqual(airing);
    // Without the reset, item-003 would follow the airing item-002.
    expect((await airings(db)).slice(2, 4)).toEqual([
      ["item-001", 0],
      ["item-002", 1],
    ]);
  });

  it("never returns to pre-reset progress when the schedule regenerates later", async () => {
    const { server, db } = await airingSecondEntry("chronological");
    await send(server, "POST", RESET_URL);

    const regenerated = await send(
      server,
      "POST",
      `/channels/${CHANNEL_ID}/schedule/generate`,
      { regenerate: true },
    );

    expect(regenerated.status).toBe(200);
    expect((await airings(db)).slice(1, 3)).toEqual([
      ["item-002", 1],
      ["item-001", 0],
    ]);
  });

  it("restarts random's selection index and keeps its seed", async () => {
    const { server, db } = await airingSecondEntry("random");
    const before = await airings(db);

    await send(server, "POST", RESET_URL);

    const after = await airings(db);
    // Selection index 0 picks what it picked at T0, from the same seed.
    expect(after[2]).toEqual(before[0]);
    expect(after.slice(2, 5).map(([, index]) => index)).toEqual([0, 1, 2]);
  });

  it("leaves other collections and modes untouched", async () => {
    const { server, db } = await airingSecondEntry("chronological");
    await db
      .insertInto("media_collections")
      .values({ ...collectionFixture, id: "other", name: "Other" })
      .execute();
    const untouched = [
      {
        ...collectionProgressFixture,
        playback_mode: "random",
        last_media_item_id: null,
        last_position: null,
        next_selection_index: 7,
      },
      {
        ...collectionProgressFixture,
        media_collection_id: "other",
        last_media_item_id: ITEM_ID,
      },
    ] as const;
    await db
      .insertInto("channel_collection_progress")
      .values([...untouched])
      .execute();

    await send(server, "POST", RESET_URL);

    await expect(
      db
        .selectFrom("channel_collection_progress")
        .selectAll()
        .where((eb) =>
          eb.or([
            eb("playback_mode", "=", "random"),
            eb("media_collection_id", "=", "other"),
          ]),
        )
        .orderBy("media_collection_id")
        .orderBy("playback_mode")
        .execute(),
    ).resolves.toEqual([
      { ...untouched[0], reset_sequence_number: null, order_fingerprint: null },
      { ...untouched[1] },
    ]);
  });

  it("refuses an unknown block and a single-item block", async () => {
    const { server } = await startServer();

    await expect(send(server, "POST", RESET_URL)).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "programming_block_not_found" } },
    });
    await send(server, "POST", BLOCKS_URL, {
      source: { kind: "media_item", mediaItemId: ITEM_ID },
    });
    await expect(send(server, "POST", RESET_URL)).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "programming_block_has_no_order" } },
    });
  });
});

// Reads the collection's saved membership, which no playback mode may rewrite.
function savedPositions(db: Kysely<DatabaseSchema>) {
  return db
    .selectFrom("media_collection_items")
    .select(["media_item_id", "position"])
    .orderBy("position")
    .execute();
}

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
