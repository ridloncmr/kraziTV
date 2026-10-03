import type { PlayoutEntry } from "@krazitv/krazi-brain";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { channelFixture } from "../testing/channel-fixtures.js";
import {
  insertScheduleEntries,
  seedScheduleScenario,
} from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";
import {
  findCoveringPlayoutEntries,
  findPlayoutEntryById,
  listPlayoutEntriesAfter,
  listPlayoutEntriesInWindow,
} from "./playout-repository.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
const OTHER_CHANNEL_ID = "channel-other";

// Three contiguous entries, a gap, then one entry whose sequence number jumps
// as it would after a regeneration. Entry 1's media is missing with no audio
// fact. A second channel airs during the gap and after the last entry, so any
// query that drops its channel filter returns the wrong rows.
async function setup() {
  const { db } = await openTestDatabase();
  const { channelId, itemIds } = await seedScheduleScenario(db, {
    items: [
      { durationMs: 22 * MINUTE },
      { durationMs: 23 * MINUTE, status: "missing", hasAudio: null },
      { durationMs: 24 * MINUTE },
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

    const [entry] = await findCoveringPlayoutEntries(db, channelId, T0);

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
      },
    });
  });

  it("finds the covering entry and its successor, whatever its media status", async () => {
    const { db, channelId } = await setup();

    const entries = await findCoveringPlayoutEntries(
      db,
      channelId,
      T0 + 30 * MINUTE,
    );

    expect(ids(entries)).toEqual(["entry-1", "entry-2"]);
    expect(entries[0]?.media).toMatchObject({
      status: "missing",
      hasAudio: null,
    });
  });

  it("treats an entry's end as exclusive and finds the successor across a gap", async () => {
    const { db, channelId } = await setup();

    await expect(
      findCoveringPlayoutEntries(db, channelId, T0 + 45 * MINUTE).then(ids),
    ).resolves.toEqual(["entry-2", "entry-7"]);
  });

  it("finds nothing at an instant no entry covers", async () => {
    const { db, channelId } = await setup();

    await expect(
      findCoveringPlayoutEntries(db, channelId, T0 + 70 * MINUTE),
    ).resolves.toEqual([]);
  });

  it("finds the last entry alone when nothing follows it", async () => {
    const { db, channelId } = await setup();

    await expect(
      findCoveringPlayoutEntries(db, channelId, T0 + 90 * MINUTE).then(ids),
    ).resolves.toEqual(["entry-7"]);
  });

  it("finds an entry by ID with its sequence number, only on its own channel", async () => {
    const { db, channelId } = await setup();

    const found = await findPlayoutEntryById(db, channelId, "entry-2");

    expect(found?.sequenceNumber).toBe(2);
    expect(found?.entry.id).toBe("entry-2");
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

    // Only the other channel covers this instant.
    await expect(
      findCoveringPlayoutEntries(db, channelId, T0 + 70 * MINUTE),
    ).resolves.toEqual([]);
    await expect(
      findPlayoutEntryById(db, channelId, otherEntryId),
    ).resolves.toBeUndefined();
    await expect(listPlayoutEntriesAfter(db, channelId, 7, 5)).resolves.toEqual(
      [],
    );
    await expect(
      listPlayoutEntriesInWindow(
        db,
        channelId,
        T0 + 69 * MINUTE,
        T0 + 80 * MINUTE,
      ),
    ).resolves.toEqual([]);
    await expect(
      findCoveringPlayoutEntries(db, OTHER_CHANNEL_ID, T0 + 70 * MINUTE).then(
        ids,
      ),
    ).resolves.toEqual([otherEntryId, `${OTHER_CHANNEL_ID}-entry-9`]);
  });

  it("lists up to count entries after a sequence number, in sequence order", async () => {
    const { db, channelId } = await setup();

    await expect(
      listPlayoutEntriesAfter(db, channelId, 0, 2).then(ids),
    ).resolves.toEqual(["entry-1", "entry-2"]);
    await expect(
      listPlayoutEntriesAfter(db, channelId, 2, 5).then(ids),
    ).resolves.toEqual(["entry-7"]);
    await expect(listPlayoutEntriesAfter(db, channelId, 7, 5)).resolves.toEqual(
      [],
    );
  });

  it("rejects a count that is not a positive integer before reading", async () => {
    const { db, channelId } = await setup();

    // SQLite treats a negative LIMIT as no limit, so a bad count would read
    // every later entry instead of failing.
    for (const count of [0, -1, 1.5, Number.NaN]) {
      await expect(
        listPlayoutEntriesAfter(db, channelId, 0, count),
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
