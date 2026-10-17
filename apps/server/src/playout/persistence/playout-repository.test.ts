import type { PlayoutEntry } from "@krazitv/krazi-brain";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import { channelFixture } from "../../testing/channel-fixtures.js";
import {
  insertScheduleEntries,
  seedScheduleScenario,
} from "../../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import {
  findPlayoutEntryById,
  listPlayoutEntriesAround,
  listReservedTimeRanges,
  listPlayoutEntriesInWindow,
} from "./playout-repository.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
const OTHER_CHANNEL_ID = "channel-other";

// Three contiguous entries, a gap, then one entry whose sequence number jumps
// as it would after a regeneration. Entry 1's media is missing with no audio
// fact; entry 2's is audio-only. A second channel airs during the gap and after the last entry, so any
// query that drops its channel filter returns the wrong rows.
async function setup() {
  const { db } = await openTestDatabase();
  const { channelId, itemIds } = await seedScheduleScenario(db, {
    items: [
      { durationMs: 22 * MINUTE },
      { durationMs: 23 * MINUTE, status: "missing", hasAudio: null },
      { durationMs: 24 * MINUTE, hasVideo: false },
    ],
    source: "chronological",
  });
  const [first, second, third] = itemIds as [string, string, string];
  await insertScheduleEntries(db, [
    {
      mediaItemId: first,
      startsAt: T0,
      endsAt: T0 + 22 * MINUTE,
      sequenceNumber: 0,
    },
    {
      mediaItemId: second,
      startsAt: T0 + 22 * MINUTE,
      endsAt: T0 + 45 * MINUTE,
      sequenceNumber: 1,
    },
    {
      mediaItemId: third,
      startsAt: T0 + 45 * MINUTE,
      endsAt: T0 + 69 * MINUTE,
      sequenceNumber: 2,
    },
    {
      mediaItemId: first,
      startsAt: T0 + 80 * MINUTE,
      endsAt: T0 + 102 * MINUTE,
      sequenceNumber: 7,
    },
  ]);
  await db
    .insertInto("channels")
    .values({ ...channelFixture, id: OTHER_CHANNEL_ID, number: "70" })
    .execute();
  await insertScheduleEntries(db, [
    {
      channelId: OTHER_CHANNEL_ID,
      mediaItemId: first,
      startsAt: T0 + 60 * MINUTE,
      endsAt: T0 + 75 * MINUTE,
      sequenceNumber: 3,
    },
    {
      channelId: OTHER_CHANNEL_ID,
      mediaItemId: first,
      startsAt: T0 + 110 * MINUTE,
      endsAt: T0 + 120 * MINUTE,
      sequenceNumber: 9,
    },
  ]);
  return { db, channelId };
}

// The entry IDs a query returned, so ordering tests read as sequences.
function ids(entries: readonly PlayoutEntry[]): string[] {
  return entries.map((entry) => entry.id);
}

describe("playout queries", () => {
  it("projects an entry with its media facts as stored", async () => {
    const { db, channelId } = await setup();

    const entry = await findPlayoutEntryById(db, channelId, "entry-0");

    expect(entry).toEqual({
      id: "entry-0",
      mediaItemId: "item-001",
      title: "Entry 0",
      startsAt: T0,
      endsAt: T0 + 22 * MINUTE,
      createdAt: T0,
      updatedAt: T0,
      media: {
        path: "/media/movies/item-001.mkv",
        status: "available",
        durationMs: 22 * MINUTE,
        hasAudio: true,
        hasVideo: true,
      },
    });
  });

  it("projects an audio-only item's missing video stream", async () => {
    const { db, channelId } = await setup();

    const entry = await findPlayoutEntryById(db, channelId, "entry-2");

    expect(entry?.media).toMatchObject({ hasVideo: false });
  });

  it("finds an entry by ID, only on its own channel", async () => {
    const { db, channelId } = await setup();

    const found = await findPlayoutEntryById(db, channelId, "entry-2");

    expect(found).toMatchObject({ id: "entry-2", startsAt: T0 + 45 * MINUTE });
    await expect(
      findPlayoutEntryById(db, channelId, "entry-gone"),
    ).resolves.toBeUndefined();
    await expect(
      findPlayoutEntryById(db, OTHER_CHANNEL_ID, "entry-2"),
    ).resolves.toBeUndefined();
  });

  it("never returns another channel's entries", async () => {
    const { db, channelId } = await setup();
    const otherEntryId = `${OTHER_CHANNEL_ID}-entry-3`;

    await expect(
      findPlayoutEntryById(db, channelId, otherEntryId),
    ).resolves.toBeUndefined();
    await expect(
      listPlayoutEntriesAround(db, channelId, T0 + 103 * MINUTE, 5).then(ids),
    ).resolves.toEqual(["entry-7"]);
    await expect(
      listReservedTimeRanges(db, OTHER_CHANNEL_ID, T0),
    ).resolves.toEqual([]);
    await expect(
      listPlayoutEntriesInWindow(
        db,
        channelId,
        T0 + 69 * MINUTE,
        T0 + 80 * MINUTE,
      ),
    ).resolves.toEqual([]);
    await expect(
      listPlayoutEntriesAround(db, OTHER_CHANNEL_ID, T0 + 70 * MINUTE, 1).then(
        ids,
      ),
    ).resolves.toEqual([otherEntryId, `${OTHER_CHANNEL_ID}-entry-9`]);
  });

  it("lists the entry starting at or before an instant and up to count after it, however far", async () => {
    const { db, channelId } = await setup();

    // In the gap after entry-2: the one before it and the next one, 11 minutes on.
    await expect(
      listPlayoutEntriesAround(db, channelId, T0 + 70 * MINUTE, 1).then(ids),
    ).resolves.toEqual(["entry-2", "entry-7"]);
    // Exactly at a start, that entry is the one around the instant.
    await expect(
      listPlayoutEntriesAround(db, channelId, T0 + 22 * MINUTE, 1).then(ids),
    ).resolves.toEqual(["entry-1", "entry-2"]);
    await expect(
      listPlayoutEntriesAround(db, channelId, T0, 5).then(ids),
    ).resolves.toEqual(["entry-0", "entry-1", "entry-2", "entry-7"]);
    // Before the first entry there is none around, only those after.
    await expect(
      listPlayoutEntriesAround(db, channelId, T0 - 1, 2).then(ids),
    ).resolves.toEqual(["entry-0", "entry-1"]);
  });

  it("lists the ranges of a channel's reservations still to end, in start order", async () => {
    const { db, channelId } = await setup();
    const reservation = {
      channel_id: channelId,
      end_kind: "explicit" as const,
      source_kind: "media_items" as const,
      media_collection_id: null,
      playback_mode: null,
      created_at: T0,
      updated_at: T0,
    };
    await db
      .insertInto("reservations")
      .values([
        {
          ...reservation,
          id: "late",
          starts_at: T0 + 200 * MINUTE,
          ends_at: T0 + 230 * MINUTE,
        },
        {
          ...reservation,
          id: "ended",
          starts_at: T0 + 10 * MINUTE,
          ends_at: T0 + 20 * MINUTE,
        },
        {
          ...reservation,
          id: "early",
          starts_at: T0 + 70 * MINUTE,
          ends_at: T0 + 80 * MINUTE,
        },
      ])
      .execute();

    // A range ending exactly at the instant has ended.
    await expect(
      listReservedTimeRanges(db, channelId, T0 + 20 * MINUTE),
    ).resolves.toEqual([
      { startsAt: T0 + 70 * MINUTE, endsAt: T0 + 80 * MINUTE },
      { startsAt: T0 + 200 * MINUTE, endsAt: T0 + 230 * MINUTE },
    ]);
  });

  it("rejects a count that is not a positive integer before reading", async () => {
    const { db, channelId } = await setup();

    // SQLite treats a negative LIMIT as no limit, so a bad count would read
    // every later entry instead of failing.
    for (const count of [0, -1, 1.5, Number.NaN]) {
      await expect(
        listPlayoutEntriesAround(db, channelId, T0, count),
      ).rejects.toThrow(`following count must be a positive integer: ${count}`);
    }
  });

  it("lists entries overlapping a window in sequence order, edges exclusive", async () => {
    const { db, channelId } = await setup();

    await expect(
      listPlayoutEntriesInWindow(
        db,
        channelId,
        T0 + 22 * MINUTE,
        T0 + 81 * MINUTE,
      ).then(ids),
    ).resolves.toEqual(["entry-1", "entry-2", "entry-7"]);
    await expect(
      listPlayoutEntriesInWindow(
        db,
        channelId,
        T0 + 69 * MINUTE,
        T0 + 80 * MINUTE,
      ),
    ).resolves.toEqual([]);
  });
});
