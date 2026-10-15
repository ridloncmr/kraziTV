import { type PlaybackMode, SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { send } from "../testing/api-requests.js";
import {
  collectionAssignment,
  itemAssignment,
} from "../testing/assignment-bodies.js";
import {
  collectionFixture,
  FIXTURE_TIME,
} from "../testing/catalog-fixtures.js";
import {
  channelFixture,
  collectionProgressFixture,
} from "../testing/channel-fixtures.js";
import { episodeFacts, movieFacts } from "../testing/collection-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import {
  insertCollectionOfItems,
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
import { AssignmentRepository } from "./assignment-repository.js";

afterEach(cleanUpTestEnvironment);

const T0 = FIXTURE_TIME;
const EPISODES = [22, 23, 24].map((minutes) => ({
  durationMs: minutes * 60_000,
}));
// The IDs seedScheduleScenario writes.
const CHANNEL_ID = "channel-fixture-001";
const COLLECTION_ID = "collection-fixture-001";
const ITEM_ID = "item-001";
const ASSIGNMENTS_URL = `/channels/${CHANNEL_ID}/programming-assignments`;
const ASSIGNMENT_URL = `${ASSIGNMENTS_URL}/assignment-001`;

const collectionBody = collectionAssignment(COLLECTION_ID);

// Boots the real composition over a channel with no assignment yet, with
// fixed IDs and time. A null scenario reopens the data directory without seeding.
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
      assignments: new AssignmentRepository(db, {
        createId: sequentialIds("assignment"),
      }),
      schedules: new ScheduleService(db, { now: clock.now }),
    }),
  });
  return { server, db, clock };
}

describe("programming assignment routes", () => {
  it("lists no assignments for a channel without programming", async () => {
    const { server } = await startServer();

    await expect(send(server, "GET", ASSIGNMENTS_URL)).resolves.toEqual({
      status: 200,
      body: [],
    });
  });

  it("creates a collection assignment and lists it", async () => {
    const { server } = await startServer();
    const expected = {
      id: "assignment-001",
      channelId: CHANNEL_ID,
      ...collectionBody,
      createdAt: new Date(T0).toISOString(),
      updatedAt: new Date(T0).toISOString(),
    };

    await expect(
      send(server, "POST", ASSIGNMENTS_URL, collectionBody),
    ).resolves.toEqual({ status: 201, body: expected });
    await expect(send(server, "GET", ASSIGNMENTS_URL)).resolves.toEqual({
      status: 200,
      body: [expected],
    });
  });

  it("creates a single-item assignment", async () => {
    const { server } = await startServer();
    const body = itemAssignment(ITEM_ID);

    const response = await send(server, "POST", ASSIGNMENTS_URL, body);

    expect(response).toMatchObject({ status: 201, body });
  });

  it.each(["GET", "POST"] as const)(
    "reports an unknown channel on %s",
    async (method) => {
      const { server } = await startServer();

      const response = await send(
        server,
        method,
        "/channels/missing/programming-assignments",
        method === "POST" ? collectionBody : undefined,
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
      collectionAssignment("missing"),
      "media_collection_not_found",
    ],
    ["media item", itemAssignment("missing"), "media_item_not_found"],
  ])("rejects an unknown %s", async (_, body, code) => {
    const { server, db } = await startServer();

    const response = await send(server, "POST", ASSIGNMENTS_URL, body);

    expect(response).toMatchObject({ status: 400, body: { error: { code } } });
    await expect(
      db.selectFrom("programming_source_assignments").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it.each([
    ["a missing body", {}],
    [
      "a missing member kind",
      { ...collectionBody, members: [{ mediaItemId: ITEM_ID }] },
    ],
    [
      "a doubled member source",
      {
        ...collectionBody,
        members: [
          {
            kind: "collection",
            mediaCollectionId: COLLECTION_ID,
            mediaItemId: ITEM_ID,
          },
        ],
      },
    ],
    [
      "a mode with only an item",
      { ...itemAssignment(ITEM_ID), playbackMode: "random" },
    ],
    ["a collection without a mode", { ...collectionBody, playbackMode: null }],
    ["an unsupported mode", { ...collectionBody, playbackMode: "shuffle" }],
    ["no members", { ...collectionBody, members: [] }],
    [
      "a repeated member",
      {
        ...collectionBody,
        members: [...collectionBody.members, ...collectionBody.members],
      },
    ],
    [
      "a zero program count",
      { ...collectionBody, ordinaryStretch: { kind: "programs", count: 0 } },
    ],
    [
      "a fractional program count",
      { ...collectionBody, ordinaryStretch: { kind: "programs", count: 1.5 } },
    ],
    ["an unknown field", { ...collectionBody, name: "Prime time" }],
  ])("rejects %s", async (_, payload) => {
    const { server } = await startServer();

    const response = await send(server, "POST", ASSIGNMENTS_URL, payload);

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });

  it("saves several members in order and gives successive turns to each", async () => {
    const { server, db } = await startServer();
    await insertCollectionOfItems(db, "parks", [22 * 60_000, 22 * 60_000]);
    const body = {
      ...collectionBody,
      ordinaryStretch: { kind: "programs", count: 2 },
      members: [
        { kind: "collection", mediaCollectionId: COLLECTION_ID },
        { kind: "media_item", mediaItemId: "parks-2" },
        { kind: "collection", mediaCollectionId: "parks" },
      ],
    };

    const created = await send(server, "POST", ASSIGNMENTS_URL, body);

    expect(created).toMatchObject({ status: 201, body });
    const turns = await db
      .selectFrom("programming_blocks")
      .select(["media_collection_id", "media_item_id"])
      .orderBy("starts_at")
      .limit(4)
      .execute();
    expect(turns).toEqual([
      { media_collection_id: COLLECTION_ID, media_item_id: null },
      { media_collection_id: null, media_item_id: "parks-2" },
      { media_collection_id: "parks", media_item_id: null },
      { media_collection_id: COLLECTION_ID, media_item_id: null },
    ]);
  });

  it("adds further assignments after the first, in saved order", async () => {
    const { server } = await startServer();
    await send(server, "POST", ASSIGNMENTS_URL, collectionBody);

    const second = await send(
      server,
      "POST",
      ASSIGNMENTS_URL,
      itemAssignment(ITEM_ID),
    );

    expect(second.status).toBe(201);
    const listed = await send(server, "GET", ASSIGNMENTS_URL);
    expect(listed.body.map((entry: { id: string }) => entry.id)).toEqual([
      "assignment-001",
      "assignment-002",
    ]);
  });

  it("refuses a member another assignment on the channel already plays", async () => {
    const { server, db } = await startServer();
    await send(server, "POST", ASSIGNMENTS_URL, collectionBody);
    await send(server, "POST", ASSIGNMENTS_URL, itemAssignment(ITEM_ID));

    const created = await send(
      server,
      "POST",
      ASSIGNMENTS_URL,
      collectionAssignment(COLLECTION_ID, "random"),
    );
    const changed = await send(
      server,
      "PATCH",
      `${ASSIGNMENTS_URL}/assignment-002`,
      collectionBody,
    );

    for (const response of [created, changed]) {
      expect(response).toMatchObject({
        status: 409,
        body: {
          error: {
            code: "programming_member_assigned",
            assignmentId: "assignment-001",
            member: { kind: "collection", mediaCollectionId: COLLECTION_ID },
          },
        },
      });
    }
    await expect(
      db.selectFrom("programming_source_assignments").select("id").execute(),
    ).resolves.toHaveLength(2);
  });

  it("saves a new assignment order and refuses one that does not name each assignment once", async () => {
    const { server } = await startServer();
    await send(server, "POST", ASSIGNMENTS_URL, collectionBody);
    await send(server, "POST", ASSIGNMENTS_URL, itemAssignment(ITEM_ID));
    const ORDER_URL = `${ASSIGNMENTS_URL}/order`;

    const reordered = await send(server, "PUT", ORDER_URL, {
      assignmentIds: ["assignment-002", "assignment-001"],
    });

    expect(reordered.status).toBe(200);
    const listed = await send(server, "GET", ASSIGNMENTS_URL);
    expect(listed.body.map((entry: { id: string }) => entry.id)).toEqual([
      "assignment-002",
      "assignment-001",
    ]);
    for (const assignmentIds of [
      ["assignment-001"],
      ["assignment-001", "assignment-001"],
      ["assignment-001", "assignment-002", "missing"],
    ]) {
      await expect(
        send(server, "PUT", ORDER_URL, { assignmentIds }),
      ).resolves.toMatchObject({
        status: 409,
        body: {
          error: {
            code: "programming_assignment_order_mismatch",
            assignmentIds: ["assignment-002", "assignment-001"],
          },
        },
      });
    }
    await expect(
      send(server, "PUT", "/channels/missing/programming-assignments/order", {
        assignmentIds: [],
      }),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "channel_not_found" } },
    });
  });

  it("rotates several assignments, keeping the airing entry when the order changes", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "POST", ASSIGNMENTS_URL, collectionBody);
    await send(server, "POST", ASSIGNMENTS_URL, itemAssignment(ITEM_ID));
    clock.set(T0 + 30 * 60_000);
    const before = await readScheduleEntries(db, CHANNEL_ID);
    const airing = before.find(
      (entry) => entry.starts_at <= clock.now() && entry.ends_at > clock.now(),
    );

    await send(server, "PUT", `${ASSIGNMENTS_URL}/order`, {
      assignmentIds: ["assignment-002", "assignment-001"],
    });

    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(after).toContainEqual(airing);
    const blocks = await db
      .selectFrom("programming_blocks")
      .select("assignment_id")
      .orderBy("starts_at")
      .execute();
    for (let index = 1; index < blocks.length; index += 1) {
      expect(blocks[index]?.assignment_id).not.toBe(
        blocks[index - 1]?.assignment_id,
      );
    }
  });

  it("materializes the horizon at revision 1 on an enabled channel", async () => {
    const { server, db } = await startServer();

    await send(server, "POST", ASSIGNMENTS_URL, collectionBody);

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
  ])(
    "keeps the assignment but writes no schedule for %s",
    async (_, scenario) => {
      const { server, db } = await startServer(scenario);

      const response = await send(
        server,
        "POST",
        ASSIGNMENTS_URL,
        collectionBody,
      );

      expect(response.status).toBe(201);
      for (const table of [
        "channel_schedule_states",
        "schedule_entries",
        "programming_blocks",
      ] as const) {
        await expect(
          db.selectFrom(table).selectAll().execute(),
        ).resolves.toEqual([]);
      }
    },
  );

  it("keeps assignments across a restart", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const first = await startServer({}, dataDirectory);
    const created = await send(
      first.server,
      "POST",
      ASSIGNMENTS_URL,
      collectionBody,
    );
    await first.server.close();

    const second = await startServer(null, dataDirectory);

    await expect(send(second.server, "GET", ASSIGNMENTS_URL)).resolves.toEqual({
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
      const response = await send(
        server,
        "POST",
        ASSIGNMENTS_URL,
        collectionBody,
      );

      expect(response).toMatchObject({
        status: 503,
        body: { error: { code: "schedule_busy", retryable: true } },
      });
    } finally {
      await holder.release();
    }
    await expect(
      db.selectFrom("programming_source_assignments").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});

describe("generated turns", () => {
  it("airs a three-program assignment as blocks of three whole programs", async () => {
    const { server, db } = await startServer();

    await send(server, "POST", ASSIGNMENTS_URL, collectionBody);

    const entries = await readScheduleEntries(db, CHANNEL_ID);
    const blocks = await db
      .selectFrom("programming_blocks")
      .selectAll()
      .orderBy("starts_at")
      .execute();
    expect(blocks.slice(0, 2)).toMatchObject([
      {
        assignment_id: "assignment-001",
        media_collection_id: COLLECTION_ID,
        round_number: 1,
        turn_index: 0,
        starts_at: T0,
        resolved_kind: "programs",
        resolved_value: 3,
      },
      { round_number: 2, starts_at: entries[3]?.starts_at },
    ]);
    expect(
      entries.slice(0, 6).map((entry) => entry.programming_block_id),
    ).toEqual([
      blocks[0]?.id,
      blocks[0]?.id,
      blocks[0]?.id,
      blocks[1]?.id,
      blocks[1]?.id,
      blocks[1]?.id,
    ]);
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

    await send(server, "POST", ASSIGNMENTS_URL, collectionBody);
    const created = await send(
      server,
      "POST",
      `/channels/${other.id}/programming-assignments`,
      collectionAssignment(COLLECTION_ID, "episode"),
    );

    expect(created).toMatchObject({
      status: 201,
      body: { playbackMode: "episode" },
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

describe("collection preview", () => {
  const PREVIEW_URL = `${ASSIGNMENT_URL}/preview?mediaCollectionId=${COLLECTION_ID}`;
  // Five members in saved order: Office 1x2, Parks 1x1, Office 1x1, a
  // duplicate Office 1x1, and one with no episode details.
  const MEMBERS = Array.from({ length: 5 }, () => ({
    durationMs: 30 * 60_000,
  }));

  // Starts the server with the five members, their facts, and an assignment.
  async function previewServer(playbackMode: PlaybackMode) {
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
    await send(
      context.server,
      "POST",
      ASSIGNMENTS_URL,
      collectionAssignment(COLLECTION_ID, playbackMode),
    );
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
      `${PREVIEW_URL}&playbackMode=chronological`,
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

  it("refuses a collection the assignment does not play, an unknown assignment, and an unknown mode", async () => {
    const { server } = await startServer();
    await send(server, "POST", ASSIGNMENTS_URL, itemAssignment(ITEM_ID));

    await expect(send(server, "GET", PREVIEW_URL)).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "media_collection_not_assigned" } },
    });
    await expect(
      send(
        server,
        "GET",
        `${ASSIGNMENTS_URL}/missing/preview?mediaCollectionId=${COLLECTION_ID}`,
      ),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "media_collection_not_assigned" } },
    });
    await expect(
      send(server, "GET", `${PREVIEW_URL}&playbackMode=shuffle`),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });
});

describe("progress reset", () => {
  const RESET_URL = `${ASSIGNMENT_URL}/progress-reset`;
  const RESET_BODY = { mediaCollectionId: COLLECTION_ID };

  // Plays the three episodes in `playbackMode` from T0, then sets the clock
  // to 30 minutes, while the second entry (item-002) airs.
  async function airingSecondEntry(playbackMode: PlaybackMode) {
    const context = await startServer();
    await send(
      context.server,
      "POST",
      ASSIGNMENTS_URL,
      collectionAssignment(COLLECTION_ID, playbackMode),
    );
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

    const response = await send(server, "POST", RESET_URL, RESET_BODY);

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
    await send(server, "POST", RESET_URL, RESET_BODY);

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

    await send(server, "POST", RESET_URL, RESET_BODY);

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

    await send(server, "POST", RESET_URL, RESET_BODY);

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

  it("refuses an unknown assignment, a collection it does not play, and a missing body", async () => {
    const { server } = await startServer();

    await expect(
      send(server, "POST", RESET_URL, RESET_BODY),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "media_collection_not_assigned" } },
    });
    await send(server, "POST", ASSIGNMENTS_URL, itemAssignment(ITEM_ID));
    await expect(
      send(server, "POST", RESET_URL, RESET_BODY),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "media_collection_not_assigned" } },
    });
    await expect(send(server, "POST", RESET_URL)).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
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

describe("changing and deleting an assignment", () => {
  const randomBody = collectionAssignment(COLLECTION_ID, "random");

  // Creates the collection assignment at T0, then moves the clock into the second episode (22–45 minutes).
  async function startScheduled() {
    const context = await startServer();
    await send(context.server, "POST", ASSIGNMENTS_URL, collectionBody);
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

  it("replaces the settings and regenerates after the airing entry", async () => {
    const { server, db } = await startScheduled();
    const before = await readSchedule(db);

    const response = await send(server, "PATCH", ASSIGNMENT_URL, randomBody);

    expect(response).toEqual({
      status: 200,
      body: {
        id: "assignment-001",
        channelId: CHANNEL_ID,
        ...randomBody,
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

  it("writes nothing for identical settings", async () => {
    const { server, db } = await startScheduled();
    const before = await readSchedule(db);

    const response = await send(server, "PATCH", ASSIGNMENT_URL, {
      ...collectionBody,
    });

    expect(response).toMatchObject({
      status: 200,
      body: { updatedAt: new Date(T0).toISOString() },
    });
    await expect(readSchedule(db)).resolves.toEqual(before);
  });

  it("deletes the assignment, keeping the airing entry and its block as history", async () => {
    const { server, db } = await startScheduled();
    const before = await readSchedule(db);

    const response = await server.inject({
      method: "DELETE",
      url: ASSIGNMENT_URL,
    });

    expect(response.statusCode).toBe(204);
    await expect(send(server, "GET", ASSIGNMENTS_URL)).resolves.toEqual({
      status: 200,
      body: [],
    });
    const after = await readSchedule(db);
    expect(after.revision).toBe(2);
    expect(after.entries).toEqual(before.entries.slice(0, 2));
    await expect(
      db.selectFrom("programming_blocks").select("assignment_id").execute(),
    ).resolves.toEqual([{ assignment_id: null }]);
  });

  it.each([
    ["an unknown assignment", `${ASSIGNMENTS_URL}/missing`],
    [
      "another channel's assignment",
      "/channels/missing/programming-assignments/assignment-001",
    ],
  ])("reports %s as not found", async (_, url) => {
    const { server } = await startScheduled();

    const patched = await send(server, "PATCH", url, randomBody);
    const deleted = await send(server, "DELETE", url);

    for (const response of [patched, deleted]) {
      expect(response).toMatchObject({
        status: 404,
        body: { error: { code: "programming_assignment_not_found" } },
      });
    }
  });

  it("rejects an unknown collection and keeps the old settings", async () => {
    const { server, db } = await startScheduled();
    const before = await readSchedule(db);

    const response = await send(
      server,
      "PATCH",
      ASSIGNMENT_URL,
      collectionAssignment("missing"),
    );

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "media_collection_not_found" } },
    });
    await expect(readSchedule(db)).resolves.toEqual(before);
  });

  it("rejects an invalid body", async () => {
    const { server } = await startScheduled();

    const response = await send(server, "PATCH", ASSIGNMENT_URL, {
      ...collectionBody,
      playbackMode: "shuffle",
    });

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });
});

describe("stretch settings", () => {
  it.each([
    { kind: "airtime", minutes: 60 },
    { kind: "airtime_range", minMinutes: 60, maxMinutes: 120 },
  ])("saves and reads back %o", async (ordinaryStretch) => {
    const { server } = await startServer();

    const created = await send(server, "POST", ASSIGNMENTS_URL, {
      ...collectionBody,
      ordinaryStretch,
    });

    expect(created).toMatchObject({ status: 201, body: { ordinaryStretch } });
    await expect(send(server, "GET", ASSIGNMENTS_URL)).resolves.toMatchObject({
      body: [{ ordinaryStretch }],
    });
  });

  it.each([
    [{ kind: "airtime", minutes: 0 }, "minutes must be a positive integer"],
    [
      { kind: "airtime_range", minMinutes: 30, maxMinutes: 30.5 },
      "maxMinutes must be a positive integer",
    ],
    [
      { kind: "airtime_range", minMinutes: 90, maxMinutes: 60 },
      "maxMinutes must be at least minMinutes",
    ],
  ])("refuses %o with kraziBrain's reason", async (ordinaryStretch, reason) => {
    const { server } = await startServer();

    const response = await send(server, "POST", ASSIGNMENTS_URL, {
      ...collectionBody,
      ordinaryStretch,
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(reason);
  });

  it("airs whole 22-minute episodes for a 60-minute target, overrunning to 66", async () => {
    const { server, db } = await startServer();
    await send(server, "POST", ASSIGNMENTS_URL, {
      ...collectionBody,
      ordinaryStretch: { kind: "airtime", minutes: 60 },
    });

    const [first] = await db
      .selectFrom("programming_blocks")
      .select("id")
      .orderBy("starts_at")
      .execute();
    const aired = (await readScheduleEntries(db, CHANNEL_ID)).filter(
      (entry) => entry.programming_block_id === first?.id,
    );
    // The scenario's episodes run 22, 23, and 24 minutes.
    expect(aired.map((entry) => entry.duration_ms / 60_000)).toEqual([
      22, 23, 24,
    ]);
  });
});

describe("stretch suggestion", () => {
  // The suggestion URL for members, as the editor builds it.
  function suggestionUrl(
    members: readonly (
      | { kind: string; mediaCollectionId: string }
      | { kind: string; mediaItemId: string }
    )[],
  ) {
    const ids = (field: "mediaCollectionId" | "mediaItemId") =>
      members.flatMap((member) =>
        field in member ? [(member as Record<string, string>)[field]] : [],
      );
    const query = new URLSearchParams({
      mediaCollectionIds: ids("mediaCollectionId").join(","),
      mediaItemIds: ids("mediaItemId").join(","),
    });
    return `/programming-assignments/stretch-suggestion?${query}`;
  }

  // Seeds collections of movies, episodes, both, and unclassified items.
  async function suggestionServer() {
    const context = await startServer();
    const { db } = context;
    const movies = await insertCollectionOfItems(db, "movies", [
      120 * 60_000,
      100 * 60_000,
    ]);
    const shows = await insertCollectionOfItems(db, "shows", [22 * 60_000]);
    await insertCollectionOfItems(db, "unclassified", [30 * 60_000]);
    await db
      .insertInto("content_facts")
      .values([
        ...movies.map((id) => movieFacts(id, null, "1999")),
        ...shows.map((id) => episodeFacts(id, 2316, 1, 1)),
      ])
      .execute();
    return context;
  }

  it.each([
    [[{ kind: "collection", mediaCollectionId: "movies" }], { count: 1 }],
    [[{ kind: "media_item", mediaItemId: "movies-1" }], { count: 1 }],
    [[{ kind: "collection", mediaCollectionId: "shows" }], { count: 3 }],
    [
      [
        { kind: "collection", mediaCollectionId: "movies" },
        { kind: "collection", mediaCollectionId: "shows" },
      ],
      null,
    ],
    [[{ kind: "collection", mediaCollectionId: "unclassified" }], null],
  ])("suggests for %o", async (members, suggested) => {
    const { server } = await suggestionServer();

    const response = await send(server, "GET", suggestionUrl(members));

    expect(response).toEqual({
      status: 200,
      body: {
        ordinaryStretch:
          suggested === null ? null : { kind: "programs", ...suggested },
      },
    });
  });

  it("leaves an unschedulable movie out of the decision", async () => {
    const { server, db } = await suggestionServer();
    await db
      .updateTable("media_items")
      .set({ status: "missing" })
      .where("id", "=", "movies-2")
      .execute();
    await db
      .insertInto("media_collection_items")
      .values({
        media_collection_id: "shows",
        media_item_id: "movies-2",
        position: 1,
        created_at: T0,
      })
      .execute();

    await expect(
      send(
        server,
        "GET",
        suggestionUrl([{ kind: "collection", mediaCollectionId: "shows" }]),
      ),
    ).resolves.toMatchObject({
      body: { ordinaryStretch: { kind: "programs", count: 3 } },
    });
  });
});
