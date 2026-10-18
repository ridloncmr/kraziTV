// Seeds schedulable channels for tests only; production code must never import this module.
import type { PlaybackMode } from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import {
  collectionFixture,
  itemFixture,
  titledItemFixture,
  rootFixture,
} from "./catalog-fixtures.js";
import {
  assignmentFixture,
  assignmentMemberFixture,
  channelFixture,
  scheduleEntryFixture,
  scheduleStateFixture,
} from "./channel-fixtures.js";
import { toSqliteBoolean } from "../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";

export interface ScheduleItemSpec {
  durationMs: number | null;
  status?: MediaItemTable["status"];
  /** Defaults to the item fixture's audio fact; null records none, as an unprobed file has. */
  hasAudio?: boolean | null;
  /** Defaults to the item fixture's video fact; null records none, as an item cataloged before video detection has. */
  hasVideo?: boolean | null;
  /** A real file for suites that transmit it; defaults to a placeholder path. */
  path?: string;
}

export interface ScheduleScenarioOptions {
  /** The collection's members, in membership order. */
  items: readonly ScheduleItemSpec[];
  /** What the channel's one assignment plays: the collection in a mode, its first item, or nothing. */
  source: PlaybackMode | "media_item" | null;
  enabled?: boolean;
}

export interface ScheduleScenario {
  channelId: string;
  collectionId: string;
  itemIds: string[];
}

/**
 * Inserts one channel, one collection of the given items, and an
 * assignment of them, three programs a turn, so a schedule test states only
 * the durations and source it cares about.
 */
export async function seedScheduleScenario(
  db: Kysely<DatabaseSchema>,
  options: ScheduleScenarioOptions,
): Promise<ScheduleScenario> {
  const channelId = channelFixture.id;
  const collectionId = collectionFixture.id;
  const itemIds = options.items.map(
    (_, index) => `item-${String(index + 1).padStart(3, "0")}`,
  );

  await db
    .insertInto("channels")
    .values({ ...channelFixture, enabled: options.enabled === false ? 0 : 1 })
    .execute();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_collections").values(collectionFixture).execute();
  if (options.items.length > 0) {
    await db
      .insertInto("media_items")
      .values(
        options.items.map((item, index) => {
          const path = item.path ?? `/media/movies/${itemIds[index]}.mkv`;
          return {
            ...itemFixture,
            id: itemIds[index],
            path,
            path_key: path,
            title: `Item ${index + 1}`,
            duration_ms: item.durationMs,
            has_audio:
              item.hasAudio === undefined
                ? itemFixture.has_audio
                : item.hasAudio === null
                  ? null
                  : toSqliteBoolean(item.hasAudio),
            has_video:
              item.hasVideo === undefined
                ? itemFixture.has_video
                : item.hasVideo === null
                  ? null
                  : toSqliteBoolean(item.hasVideo),
            status: item.status ?? "available",
          };
        }),
      )
      .execute();
    await db
      .insertInto("media_collection_items")
      .values(
        itemIds.map((mediaItemId, position) => ({
          media_collection_id: collectionId,
          media_item_id: mediaItemId,
          position,
          created_at: itemFixture.created_at,
        })),
      )
      .execute();
  }

  if (options.source === "media_item") {
    await db
      .insertInto("programming_source_assignments")
      .values({ ...assignmentFixture, playback_mode: null })
      .execute();
    await db
      .insertInto("programming_assignment_members")
      .values({
        ...assignmentMemberFixture,
        source_kind: "media_item",
        media_collection_id: null,
        media_item_id: itemIds[0],
      })
      .execute();
  } else if (options.source !== null) {
    await insertCollectionAssignment(db, { playbackMode: options.source });
  }

  return { channelId, collectionId, itemIds };
}

/**
 * Inserts an assignment that plays one collection on a channel, three
 * programs a turn, defaulting to the fixture channel, collection, and
 * collection order; insert the channel and collection first.
 */
export async function insertCollectionAssignment(
  db: Kysely<DatabaseSchema>,
  options: {
    id?: string;
    channelId?: string;
    mediaCollectionId?: string;
    playbackMode?: PlaybackMode;
  } = {},
): Promise<void> {
  const id = options.id ?? assignmentFixture.id;
  const channelId = options.channelId ?? channelFixture.id;
  await db
    .insertInto("programming_source_assignments")
    .values({
      ...assignmentFixture,
      id,
      channel_id: channelId,
      playback_mode: options.playbackMode ?? "chronological",
    })
    .execute();
  await db
    .insertInto("programming_assignment_members")
    .values({
      ...assignmentMemberFixture,
      assignment_id: id,
      channel_id: channelId,
      media_collection_id:
        options.mediaCollectionId ??
        assignmentMemberFixture.media_collection_id,
    })
    .execute();
}

/**
 * Inserts a collection `id` of available items `<id>-1`, `<id>-2`, ... with
 * the given durations, in that saved order, titled by their IDs, so a
 * multi-source test can tell every source's airings apart. Insert the
 * fixture root first.
 */
export async function insertCollectionOfItems(
  db: Kysely<DatabaseSchema>,
  id: string,
  durationsMs: readonly number[],
): Promise<string[]> {
  const itemIds = durationsMs.map((_, index) => `${id}-${index + 1}`);
  await db
    .insertInto("media_collections")
    .values({ ...collectionFixture, id, name: id })
    .execute();
  if (itemIds.length === 0) return itemIds;
  await db
    .insertInto("media_items")
    .values(
      itemIds.map((itemId, index) =>
        titledItemFixture(itemId, { duration_ms: durationsMs[index] ?? null }),
      ),
    )
    .execute();
  await db
    .insertInto("media_collection_items")
    .values(
      itemIds.map((mediaItemId, position) => ({
        media_collection_id: id,
        media_item_id: mediaItemId,
        position,
        created_at: itemFixture.created_at,
      })),
    )
    .execute();
  return itemIds;
}

export interface ScheduleEntrySpec {
  mediaItemId: string;
  startsAt: number;
  endsAt: number;
  sequenceNumber: number;
  /** Defaults to the fixture channel; another channel's entry IDs start with its ID. */
  channelId?: string;
}

/**
 * Inserts hand-placed entries, IDs named by sequence number, so a playout
 * test can stage gaps and sequence jumps that generation would only produce
 * after a regeneration.
 */
export async function insertScheduleEntries(
  db: Kysely<DatabaseSchema>,
  entries: readonly ScheduleEntrySpec[],
): Promise<void> {
  await db
    .insertInto("schedule_entries")
    .values(
      entries.map((entry) => ({
        ...scheduleEntryFixture,
        id:
          entry.channelId === undefined
            ? `entry-${entry.sequenceNumber}`
            : `${entry.channelId}-entry-${entry.sequenceNumber}`,
        channel_id: entry.channelId ?? scheduleEntryFixture.channel_id,
        media_item_id: entry.mediaItemId,
        title: `Entry ${entry.sequenceNumber}`,
        starts_at: entry.startsAt,
        ends_at: entry.endsAt,
        duration_ms: entry.endsAt - entry.startsAt,
        sequence_number: entry.sequenceNumber,
        playback_index: entry.sequenceNumber,
      })),
    )
    .execute();
}

/**
 * Inserts the fixture channel's schedule state with the given coverage end
 * and revision, so a snapshot test controls coverage without generating.
 */
export async function insertScheduleState(
  db: Kysely<DatabaseSchema>,
  state: { lastGeneratedThrough: number; scheduleRevision: number },
): Promise<void> {
  await db
    .insertInto("channel_schedule_states")
    .values({
      ...scheduleStateFixture,
      last_generated_through: state.lastGeneratedThrough,
      schedule_revision: state.scheduleRevision,
      programming_revision: state.scheduleRevision,
    })
    .execute();
}

/**
 * Reads the schedule state row of a database seeded with one channel, and
 * fails if there is none, so single-channel tests can read fields directly.
 */
export function readOnlyScheduleState(db: Kysely<DatabaseSchema>) {
  return db
    .selectFrom("channel_schedule_states")
    .selectAll()
    .executeTakeFirstOrThrow();
}

/** Reads a channel's schedule entry rows in sequence order, as tests assert them. */
export function readScheduleEntries(
  db: Kysely<DatabaseSchema>,
  channelId: string,
) {
  return db
    .selectFrom("schedule_entries")
    .selectAll()
    .where("channel_id", "=", channelId)
    .orderBy("sequence_number")
    .execute();
}

/** Reads programming blocks in airing order so schedule tests can assert turn history. */
export function readBlocks(db: Kysely<DatabaseSchema>) {
  return db
    .selectFrom("programming_blocks")
    .selectAll()
    .orderBy("starts_at")
    .execute();
}

/**
 * Groups blocks' assignment IDs by round, in airing order, so rotation tests
 * can check that each round gives every source one turn.
 */
export function assignmentsByRound(
  blocks: readonly { round_number: number; assignment_id: string | null }[],
): Map<number, string[]> {
  const rounds = new Map<number, string[]>();
  for (const block of blocks) {
    rounds.set(block.round_number, [
      ...(rounds.get(block.round_number) ?? []),
      block.assignment_id ?? "",
    ]);
  }
  return rounds;
}

/**
 * Reads a channel's blocks and entries with their generated IDs dropped and
 * each entry's block named by airing position. Separate runs name rows from
 * their own ID sources, so this is what must match when the same inputs
 * generate the same programming.
 */
export async function readScheduleShape(
  db: Kysely<DatabaseSchema>,
  channelId: string,
) {
  const blocks = await readBlocks(db);
  const entries = await readScheduleEntries(db, channelId);
  const blockIndex = new Map(blocks.map((block, index) => [block.id, index]));
  return {
    // A turn's checkpoint names assignments, never block IDs.
    blocks: blocks.map(({ id: _, ...block }) => block),
    entries: entries.map(({ id: _, programming_block_id, ...entry }) => ({
      ...entry,
      block: blockIndex.get(programming_block_id ?? ""),
    })),
  };
}
