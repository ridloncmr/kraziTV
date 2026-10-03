// Seeds schedulable channels for tests only; production code must never import this module.
import type { PlaybackMode } from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import {
  collectionFixture,
  itemFixture,
  rootFixture,
} from "./catalog-fixtures.js";
import {
  channelFixture,
  programmingBlockFixture,
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
}

export interface ScheduleScenarioOptions {
  /** The collection's members, in membership order. */
  items: readonly ScheduleItemSpec[];
  /** What the channel's block plays: the collection in a mode, its first item, or no block. */
  source: PlaybackMode | "media_item" | null;
  enabled?: boolean;
}

export interface ScheduleScenario {
  channelId: string;
  collectionId: string;
  itemIds: string[];
}

/**
 * Inserts one channel, one collection of the given items, and a block over
 * them, so a schedule test states only the durations and source it cares about.
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
        options.items.map((item, index) => ({
          ...itemFixture,
          id: itemIds[index],
          path: `/media/movies/${itemIds[index]}.mkv`,
          path_key: `/media/movies/${itemIds[index]}.mkv`,
          title: `Item ${index + 1}`,
          duration_ms: item.durationMs,
          has_audio:
            item.hasAudio === undefined
              ? itemFixture.has_audio
              : item.hasAudio === null
                ? null
                : toSqliteBoolean(item.hasAudio),
          status: item.status ?? "available",
        })),
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
      .insertInto("programming_blocks")
      .values({
        ...programmingBlockFixture,
        source_kind: "media_item",
        media_collection_id: null,
        media_item_id: itemIds[0],
        playback_mode: null,
      })
      .execute();
  } else if (options.source !== null) {
    await db
      .insertInto("programming_blocks")
      .values({ ...programmingBlockFixture, playback_mode: options.source })
      .execute();
  }

  return { channelId, collectionId, itemIds };
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
