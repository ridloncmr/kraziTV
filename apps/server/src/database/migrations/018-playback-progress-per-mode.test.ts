import {
  generateProgramming,
  type PlaybackProgress,
} from "@krazitv/krazi-brain";
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../schema/database-schema.js";
import {
  collectionFixture,
  FIXTURE_TIME,
  insertTitledItems,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  channelFixture,
  collectionProgressFixture,
} from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { playbackProgressPerModeMigration } from "./018-playback-progress-per-mode.js";

afterEach(cleanUpTestEnvironment);

// Saved positions with gaps, so a migration reading the position column
// instead of each member's place in order picks the wrong item.
const MEMBERS = [
  { id: "c", position: 0 },
  { id: "a", position: 5 },
  { id: "b", position: 9 },
];

// Seeds the fixture channel and one collection per ID holding MEMBERS.
async function seeded(collectionIds: readonly string[]) {
  const { db } = await openTestDatabase();
  await db.insertInto("channels").values(channelFixture).execute();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await insertTitledItems(
    db,
    MEMBERS.map((member) => member.id),
  );
  for (const id of collectionIds) {
    await db
      .insertInto("media_collections")
      .values({ ...collectionFixture, id, name: id })
      .execute();
    await db
      .insertInto("media_collection_items")
      .values(
        MEMBERS.map((member) => ({
          media_collection_id: id,
          media_item_id: member.id,
          position: member.position,
          created_at: FIXTURE_TIME,
        })),
      )
      .execute();
  }
  return db;
}

// Returns the first item a chronological generation picks from `progress`.
function firstPick(progress: PlaybackProgress): string | undefined {
  const result = generateProgramming({
    channelSeed: 1,
    programmingSeed: 1,
    rebuildCount: 0,
    marathons: { chancePercent: 0, minOrdinaryRounds: 2 },
    assignments: [
      {
        id: "assignment",
        playbackMode: "chronological",
        ordinary: { kind: "programs", count: 1 },
        marathon: null,
        members: [
          {
            kind: "collection",
            mediaCollectionId: "collection",
            members: MEMBERS.map((member) => ({
              id: member.id,
              title: member.id,
              status: "available",
              durationMs: 60_000,
              seriesTmdbId: null,
              seriesName: null,
              seasonNumber: null,
              episodeNumber: null,
              releaseDate: null,
            })),
          },
        ],
      },
    ],
    latestTurn: undefined,
    progress: [
      {
        mediaCollectionId: "collection",
        playbackMode: "chronological",
        progress,
      },
    ],
    startsAt: FIXTURE_TIME,
    through: FIXTURE_TIME + 1,
    nextSequenceNumber: 0,
    maxEntries: 1,
    createBlockId: () => "block",
  });
  return result.kind === "generated"
    ? result.entries[0]?.mediaItemId
    : undefined;
}

// Reads one collection's progress row for a mode in the migrated shape.
async function progressRow(
  db: Kysely<DatabaseSchema>,
  mediaCollectionId: string,
  playbackMode: "chronological" | "random",
) {
  return db
    .selectFrom("channel_collection_progress")
    .selectAll()
    .where("media_collection_id", "=", mediaCollectionId)
    .where("playback_mode", "=", playbackMode)
    .executeTakeFirstOrThrow();
}

describe("018_playback_progress_per_mode", () => {
  it("picks the same next item as before for every collection in one pass", async () => {
    // Each collection's ID names its old next position.
    const cases = {
      "at-start": 0,
      "mid-collection": 2,
      "after-wrap": 3,
      "past-a-shrink": 4,
    };
    const db = await seeded(Object.keys(cases));
    // Emptied, say by catalog removal, while its old position stood at 2.
    await db
      .insertInto("media_collections")
      .values({ ...collectionFixture, id: "emptied", name: "emptied" })
      .execute();
    const legacy = db as Kysely<unknown>;
    await playbackProgressPerModeMigration.down?.(legacy);
    for (const [id, nextPosition] of Object.entries({
      ...cases,
      emptied: 2,
    })) {
      await sql`insert into channel_collection_progress values
        (${channelFixture.id}, ${id}, ${nextPosition}, 7, ${FIXTURE_TIME})`.execute(
        legacy,
      );
    }

    await playbackProgressPerModeMigration.up(legacy);

    // The emptied collection is picked from as if its members came back.
    for (const [id, nextPosition] of Object.entries({
      ...cases,
      emptied: 2,
    })) {
      const row = await progressRow(db, id, "chronological");
      expect(
        firstPick({
          lastMediaItemId: row.last_media_item_id,
          lastPosition: row.last_position,
          nextSelectionIndex: row.next_selection_index,
        }),
        id,
      ).toBe(MEMBERS[nextPosition % MEMBERS.length]?.id);
    }
  });

  it("splits each row into a chronological and a random row", async () => {
    const db = await seeded(["collection"]);
    const legacy = db as Kysely<unknown>;
    await playbackProgressPerModeMigration.down?.(legacy);
    await sql`insert into channel_collection_progress values
      (${channelFixture.id}, 'collection', 2, 7, ${FIXTURE_TIME})`.execute(
      legacy,
    );

    await playbackProgressPerModeMigration.up(legacy);

    await expect(
      db
        .selectFrom("channel_collection_progress")
        .selectAll()
        .orderBy("playback_mode")
        .execute(),
    ).resolves.toEqual([
      {
        channel_id: channelFixture.id,
        media_collection_id: "collection",
        playback_mode: "chronological",
        last_media_item_id: "a",
        last_position: 1,
        next_selection_index: 0,
        reset_sequence_number: null,
        updated_at: FIXTURE_TIME,
      },
      {
        channel_id: channelFixture.id,
        media_collection_id: "collection",
        playback_mode: "random",
        last_media_item_id: null,
        last_position: null,
        next_selection_index: 7,
        reset_sequence_number: null,
        updated_at: FIXTURE_TIME,
      },
    ]);
  });

  it("folds the rows back into one per collection on the way down", async () => {
    const db = await seeded(["collection"]);
    await db
      .insertInto("channel_collection_progress")
      .values([
        {
          ...collectionProgressFixture,
          media_collection_id: "collection",
          last_media_item_id: "a",
          last_position: 1,
        },
        {
          ...collectionProgressFixture,
          media_collection_id: "collection",
          playback_mode: "random",
          last_media_item_id: null,
          last_position: null,
          next_selection_index: 7,
        },
      ])
      .execute();
    const legacy = db as Kysely<unknown>;

    await playbackProgressPerModeMigration.down?.(legacy);

    const { rows } =
      await sql`select * from channel_collection_progress`.execute(legacy);
    expect(rows).toEqual([
      {
        channel_id: channelFixture.id,
        media_collection_id: "collection",
        next_chronological_position: 2,
        next_random_selection_index: 7,
        updated_at: FIXTURE_TIME,
      },
    ]);
  });

  it("keeps the position when the last selected item is deleted", async () => {
    const db = await seeded(["collection"]);
    await db
      .insertInto("channel_collection_progress")
      .values({
        ...collectionProgressFixture,
        media_collection_id: "collection",
        last_media_item_id: "a",
        last_position: 1,
      })
      .execute();

    await db
      .deleteFrom("media_collection_items")
      .where("media_item_id", "=", "a")
      .execute();
    await db.deleteFrom("media_items").where("id", "=", "a").execute();

    await expect(
      progressRow(db, "collection", "chronological"),
    ).resolves.toMatchObject({ last_media_item_id: null, last_position: 1 });
  });

  it.each([
    ["a negative position", { last_position: -1 }],
    ["a fractional position", { last_position: 1.5 }],
    ["an item without a position", { last_position: null }],
    ["an ordered row with a selection index", { next_selection_index: 3 }],
    [
      "a random row with a last item",
      { playback_mode: "random", next_selection_index: 3 },
    ],
    [
      "a negative selection index",
      {
        playback_mode: "random",
        last_media_item_id: null,
        last_position: null,
        next_selection_index: -1,
      },
    ],
    ["a negative reset sequence number", { reset_sequence_number: -1 }],
  ])("refuses %s", async (_label, override) => {
    const db = await seeded(["collection"]);

    await expect(
      db
        .insertInto("channel_collection_progress")
        // Typed as the valid row, since the override deliberately breaks it.
        .values({
          ...collectionProgressFixture,
          media_collection_id: "collection",
          last_media_item_id: "a",
          last_position: 1,
          ...(override as object),
        })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
