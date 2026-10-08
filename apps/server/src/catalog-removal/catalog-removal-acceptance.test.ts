// Spec 0010 acceptance: catalog removal over HTTP against the real
// composition and a real temporary SQLite file, on a manual clock.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { iso, send } from "../testing/api-requests.js";
import { captureLogLines } from "../testing/captured-log-lines.js";
import { FIXTURE_TIME, itemFixtureAt } from "../testing/catalog-fixtures.js";
import { holdWriteAuthority } from "../testing/hold-write-authority.js";
import {
  insertScheduleEntries,
  insertScheduleState,
  readOnlyScheduleState,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../testing/schedule-server.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
// The IDs seedScheduleScenario writes; the episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = "channel-fixture-001";
const COLLECTION_ID = "collection-fixture-001";
const [A, B, C] = ["item-001", "item-002", "item-003"];

// Reads the collection's members in position order.
function readMembers(db: Kysely<DatabaseSchema>) {
  return db
    .selectFrom("media_collection_items")
    .select(["media_item_id", "position"])
    .where("media_collection_id", "=", COLLECTION_ID)
    .orderBy("position")
    .execute();
}

// Reads every row a removal could write, so a refusal can prove it wrote nothing.
async function readWritableState(db: Kysely<DatabaseSchema>) {
  return {
    items: await db.selectFrom("media_items").selectAll().execute(),
    roots: await db.selectFrom("media_roots").selectAll().execute(),
    members: await db
      .selectFrom("media_collection_items")
      .selectAll()
      .execute(),
    collections: await db.selectFrom("media_collections").selectAll().execute(),
    entries: await db.selectFrom("schedule_entries").selectAll().execute(),
    states: await db
      .selectFrom("channel_schedule_states")
      .selectAll()
      .execute(),
    progress: await db
      .selectFrom("channel_collection_progress")
      .selectAll()
      .execute(),
  };
}

// Sends one removal of media items.
function removeItems(
  server: Parameters<typeof send>[0],
  mediaItemIds: string[],
) {
  return send(server, "POST", "/catalog-removals", {
    target: { mediaItemIds },
  });
}

describe("catalog removal of media items", () => {
  it("takes items out of the catalog, their collection, and future schedules while the airing program finishes", async () => {
    const { lines, stream } = captureLogLines();
    const { server, db, clock } = await startScheduleScenarioServer(
      {},
      { logger: { level: "info", stream } },
    );
    const [airing] = await readScheduleEntries(db, CHANNEL_ID);
    clock.advance(5 * MINUTE);

    const removal = await removeItems(server, [A, C]);

    expect(removal).toEqual({
      status: 200,
      body: {
        removedItemCount: 2,
        finishing: [{ channelId: CHANNEL_ID, endsAt: iso(T0 + 22 * MINUTE) }],
        interruptedChannelIds: [],
        stopFailedChannelIds: [],
        affectedChannelIds: [CHANNEL_ID],
      },
    });
    await expect(readMembers(db)).resolves.toEqual([
      { media_item_id: B, position: 0 },
    ]);
    const [kept, ...future] = await readScheduleEntries(db, CHANNEL_ID);
    expect(kept).toEqual(airing);
    expect(future.length).toBeGreaterThan(0);
    expect(future[0]?.starts_at).toBe(T0 + 22 * MINUTE);
    expect(new Set(future.map((entry) => entry.media_item_id))).toEqual(
      new Set([B]),
    );
    expect(
      lines.filter((line) => line.reason === "media_removed"),
    ).toMatchObject([{ channelId: CHANNEL_ID }]);

    const listed = await send(server, "GET", "/media-items");
    expect(
      (listed.body as { items: { id: string }[] }).items.map((item) => item.id),
    ).toEqual([B]);
    await expect(
      send(server, "GET", `/media-items/${A}`),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "media_item_not_found" } },
    });
    // The airing entry stays readable through playout until it ends.
    await expect(
      send(server, "GET", `/channels/${CHANNEL_ID}/now`),
    ).resolves.toMatchObject({
      status: 200,
      body: { currentItem: { mediaItemId: A, offsetMs: 5 * MINUTE } },
    });
  });

  it("deletes a disabled channel's future entries on removed media and generates none", async () => {
    const { server, db } = await startScheduleScenarioServer({
      enabled: false,
    });
    await insertScheduleState(db, {
      lastGeneratedThrough: T0 + 57 * MINUTE,
      scheduleRevision: 4,
    });
    await insertScheduleEntries(db, [
      {
        mediaItemId: A,
        startsAt: T0 - 10 * MINUTE,
        endsAt: T0 + 12 * MINUTE,
        sequenceNumber: 0,
      },
      {
        mediaItemId: B,
        startsAt: T0 + 12 * MINUTE,
        endsAt: T0 + 35 * MINUTE,
        sequenceNumber: 1,
      },
      {
        mediaItemId: A,
        startsAt: T0 + 35 * MINUTE,
        endsAt: T0 + 57 * MINUTE,
        sequenceNumber: 2,
      },
    ]);

    const removal = await removeItems(server, [A]);

    // A disabled channel transmits nothing, so nothing of it is finishing.
    expect(removal).toMatchObject({
      status: 200,
      body: { finishing: [], affectedChannelIds: [CHANNEL_ID] },
    });
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    expect(entries.map((entry) => entry.id)).toEqual(["entry-0"]);
    await expect(readOnlyScheduleState(db)).resolves.toMatchObject({
      schedule_revision: 5,
    });
  });

  it("purges a removed item at the first removal after its airing entry ends", async () => {
    const { server, db, clock } = await startScheduleScenarioServer();
    await db
      .insertInto("media_items")
      .values([
        itemFixtureAt("item-extra-1", "/media/movies/extra-1.mkv"),
        itemFixtureAt("item-extra-2", "/media/movies/extra-2.mkv"),
      ])
      .execute();
    clock.advance(5 * MINUTE);
    await removeItems(server, [A]);

    // A still airs, so its row and its entry wait.
    await expect(
      db
        .selectFrom("media_items")
        .select("removed_at")
        .where("id", "=", A)
        .executeTakeFirst(),
    ).resolves.toEqual({ removed_at: T0 + 5 * MINUTE });
    expect(
      (await readScheduleEntries(db, CHANNEL_ID)).filter(
        (entry) => entry.media_item_id === A,
      ),
    ).toHaveLength(1);

    clock.set(T0 + 22 * MINUTE);
    const { schedule_revision: before } = await readOnlyScheduleState(db);
    await removeItems(server, ["item-extra-1"]);

    // The entry ended exactly now, so A, its entry, and the unscheduled extra are gone.
    await expect(
      db.selectFrom("media_items").select("id").orderBy("id").execute(),
    ).resolves.toEqual([{ id: B }, { id: C }, { id: "item-extra-2" }]);
    expect(
      (await readScheduleEntries(db, CHANNEL_ID)).some(
        (entry) => entry.media_item_id === A,
      ),
    ).toBe(false);
    await expect(readOnlyScheduleState(db)).resolves.toMatchObject({
      schedule_revision: before + 1,
    });
  });

  // The preview runs the same checks, so both routes refuse alike.
  describe.each(["/catalog-removals", "/catalog-removals/preview"])(
    "POST %s",
    (url) => {
      it.each([
        [
          "a duplicate ID before an unknown one",
          ["unknown", "unknown"],
          400,
          "invalid_request",
        ],
        ["an empty item list", [], 400, "invalid_request"],
        [
          "an unknown ID before an item a block plays",
          [A, "unknown"],
          400,
          "media_item_not_found",
        ],
        ["an item a block plays", [A, B], 409, "media_item_in_use"],
      ])(
        "refuses %s and writes nothing",
        async (_, mediaItemIds, status, code) => {
          const { server, db } = await startScheduleScenarioServer({
            source: "media_item",
          });
          const before = await readWritableState(db);

          const response = await send(server, "POST", url, {
            target: { mediaItemIds },
          });

          expect(response).toMatchObject({ status, body: { error: { code } } });
          await expect(readWritableState(db)).resolves.toEqual(before);
        },
      );
    },
  );

  it("names the channels and items behind an in-use refusal", async () => {
    const { server } = await startScheduleScenarioServer({
      source: "media_item",
    });

    await expect(removeItems(server, [B, A])).resolves.toMatchObject({
      status: 409,
      body: {
        error: {
          code: "media_item_in_use",
          channelIds: [CHANNEL_ID],
          mediaItemIds: [A],
        },
      },
    });
  });

  it("advances the revision once when regeneration and purge both change a channel's entries", async () => {
    const { server, db, clock } = await startScheduleScenarioServer();
    // 150 minutes in, the 69-minute cycle airs A again; C has aired twice
    // (ended entries) and airs again later (future entries).
    clock.set(T0 + 150 * MINUTE);
    const { schedule_revision: before } = await readOnlyScheduleState(db);

    await removeItems(server, [C]);

    await expect(
      db.selectFrom("media_items").select("id").where("id", "=", C).execute(),
    ).resolves.toEqual([]);
    await expect(readOnlyScheduleState(db)).resolves.toMatchObject({
      schedule_revision: before + 1,
    });
  });

  it("purges an item that was only scheduled later in the same removal", async () => {
    const { server, db } = await startScheduleScenarioServer();
    expect(
      (await readScheduleEntries(db, CHANNEL_ID)).some(
        (entry) => entry.media_item_id === C,
      ),
    ).toBe(true);

    await removeItems(server, [C]);

    // Regeneration deleted C's future entries first, so nothing holds it.
    await expect(
      db.selectFrom("media_items").select("id").where("id", "=", C).execute(),
    ).resolves.toEqual([]);
  });

  it("refuses an item that was already removed, here and in collections", async () => {
    const { server } = await startScheduleScenarioServer();
    // A is airing, so its removed row waits for purge.
    await removeItems(server, [A]);

    await expect(removeItems(server, [A])).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "media_item_not_found" } },
    });
    await expect(
      send(server, "PUT", `/media-collections/${COLLECTION_ID}/items`, {
        mediaItemIds: [B, A],
      }),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "media_item_not_found" } },
    });
  });

  it("answers 503 retryable and writes nothing while another connection holds write authority", async () => {
    const { server, db, dataDirectory } = await startScheduleScenarioServer();
    const before = await readWritableState(db);
    const other = await openTestDatabase(dataDirectory);
    const holder = await holdWriteAuthority(other.db);
    try {
      await expect(removeItems(server, [C])).resolves.toMatchObject({
        status: 503,
        body: { error: { code: "schedule_busy", retryable: true } },
      });
    } finally {
      await holder.release();
    }
    await expect(readWritableState(db)).resolves.toEqual(before);
  });
});

describe("catalog removal preview", () => {
  it("reports what a removal would do and writes nothing", async () => {
    const { server, db, clock } = await startScheduleScenarioServer();
    clock.advance(5 * MINUTE);
    const before = await readWritableState(db);

    const preview = await send(server, "POST", "/catalog-removals/preview", {
      target: { mediaItemIds: [C, A] },
      airing: "finish",
      allowUnschedulable: true,
    });

    expect(preview).toEqual({
      status: 200,
      body: {
        itemCount: 2,
        airing: [
          {
            channelId: CHANNEL_ID,
            channelNumber: "69",
            mediaItemId: A,
            title: "Item 1",
            endsAt: iso(T0 + 22 * MINUTE),
          },
        ],
        channelsLeftUnschedulable: [],
        affectedChannelIds: [CHANNEL_ID],
      },
    });
    await expect(readWritableState(db)).resolves.toEqual(before);
  });

  it("warns about an enabled channel left with nothing to schedule", async () => {
    const { server } = await startScheduleScenarioServer();

    const preview = await send(server, "POST", "/catalog-removals/preview", {
      target: { mediaItemIds: [A, B, C] },
    });

    expect(preview).toMatchObject({
      status: 200,
      body: {
        channelsLeftUnschedulable: [
          { channelId: CHANNEL_ID, channelNumber: "69" },
        ],
      },
    });
  });

  it.each([
    [
      "a channel whose collection was already unschedulable",
      { items: [{ durationMs: 22 * MINUTE, status: "missing" as const }] },
      [A],
    ],
    ["a disabled channel", { enabled: false }, [A, B, C]],
    [
      "a channel keeping a schedulable member",
      {
        items: [22, 23, 24, 25].map((minutes) => ({
          durationMs: minutes * MINUTE,
        })),
      },
      [A, B, C],
    ],
  ])("never lists %s", async (_, scenario, mediaItemIds) => {
    const { server } = await startScheduleScenarioServer(scenario);

    const preview = await send(server, "POST", "/catalog-removals/preview", {
      target: { mediaItemIds },
    });

    expect(preview).toMatchObject({
      status: 200,
      body: { channelsLeftUnschedulable: [] },
    });
  });
});

describe("catalog removal leaving channels unschedulable", () => {
  it("refuses without consent, returning the current impact, and writes nothing", async () => {
    const { server, db } = await startScheduleScenarioServer();
    const before = await readWritableState(db);

    const removal = await removeItems(server, [A, B, C]);

    expect(removal).toMatchObject({
      status: 409,
      body: {
        error: {
          code: "channels_left_unschedulable",
          impact: {
            itemCount: 3,
            channelsLeftUnschedulable: [
              { channelId: CHANNEL_ID, channelNumber: "69" },
            ],
            affectedChannelIds: [CHANNEL_ID],
          },
        },
      },
    });
    await expect(readWritableState(db)).resolves.toEqual(before);
  });

  it("removes with consent and leaves the channel only its airing program", async () => {
    const { server, db } = await startScheduleScenarioServer();
    const [airing] = await readScheduleEntries(db, CHANNEL_ID);

    const removal = await send(server, "POST", "/catalog-removals", {
      target: { mediaItemIds: [A, B, C] },
      allowUnschedulable: true,
    });

    expect(removal).toMatchObject({
      status: 200,
      body: { removedItemCount: 3, affectedChannelIds: [CHANNEL_ID] },
    });
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual([
      airing,
    ]);
  });
});
