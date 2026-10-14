import {
  type GeneratedScheduleEntry,
  NO_PROGRESS,
  type PlaybackMode,
  type PlaybackProgress,
  type RestorableEntry,
  restorePlaybackProgress,
  type ScheduleMedia,
  type ScheduleSource,
} from "@krazitv/krazi-brain";
import type { Kysely, Selectable } from "kysely";

import {
  fromSqliteBoolean,
  toSqliteBoolean,
} from "../database/columns/sqlite-boolean.js";
import type { ChannelScheduleStateTable } from "../database/schema/channel-schedule-state-table.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ScheduleEntryTable } from "../database/schema/schedule-entry-table.js";
import type { MediaItemStatus } from "../database/schema/media-item-table.js";
import {
  effectiveContentIdentity,
  effectiveMetadata,
  METADATA_COLUMNS,
  type MetadataColumns,
} from "../media-items/effective-metadata.js";
import { selectWithMetadata } from "../media-items/media-item-repository.js";
import { toProgrammingBlockSource } from "../programming-blocks/programming-block-repository.js";
import type { ScheduleEntry, ScheduleState } from "./contracts.js";

// Every function here takes the caller's executor: schedule mutations run
// only inside immediate transactions, ScheduleService's or catalog purge's,
// so each read-modify-write sees and commits one consistent state, and window
// reads run inside a deferred read snapshot.

type Executor = Kysely<DatabaseSchema>;

/** Returns whether the channel is enabled, or undefined when it does not exist. */
export async function findChannelEnabled(
  trx: Executor,
  channelId: string,
): Promise<boolean | undefined> {
  const row = await trx
    .selectFrom("channels")
    .select("enabled")
    .where("id", "=", channelId)
    .executeTakeFirst();
  return row === undefined ? undefined : fromSqliteBoolean(row.enabled);
}

/** Lists every enabled channel's ID in ID order, so maintenance runs in a stable order. */
export async function listEnabledChannelIds(trx: Executor): Promise<string[]> {
  const rows = await trx
    .selectFrom("channels")
    .select("id")
    .where("enabled", "=", toSqliteBoolean(true))
    .orderBy("id")
    .execute();
  return rows.map((row) => row.id);
}

/** Loads a channel's schedule state, or undefined before its first generation. */
export async function loadScheduleState(
  trx: Executor,
  channelId: string,
): Promise<ScheduleState | undefined> {
  const row = await trx
    .selectFrom("channel_schedule_states")
    .selectAll()
    .where("channel_id", "=", channelId)
    .executeTakeFirst();
  return row === undefined ? undefined : toScheduleState(row);
}

/** Returns the latest schedule mutation time across all channels, or undefined before any. */
export async function findLatestScheduleMutation(
  trx: Executor,
): Promise<number | undefined> {
  const row = await trx
    .selectFrom("channel_schedule_states")
    .select((eb) => eb.fn.max("updated_at").as("latest"))
    .executeTakeFirst();
  return row?.latest ?? undefined;
}

/**
 * Resolves the channel's block into the source kraziBrain generates from:
 * collection members in saved membership order, or the single item, each
 * with its effective ordering facts. Returns undefined when the channel has
 * no block.
 */
export async function loadScheduleSource(
  trx: Executor,
  channelId: string,
): Promise<ScheduleSource | undefined> {
  const block = await trx
    .selectFrom("programming_blocks")
    .selectAll()
    .where("channel_id", "=", channelId)
    .executeTakeFirst();
  if (block === undefined) return undefined;

  const source = toProgrammingBlockSource(block);
  if (source.kind === "collection") {
    const members = await selectScheduleMedia(trx)
      .innerJoin(
        "media_collection_items",
        "media_collection_items.media_item_id",
        "media_items.id",
      )
      .where(
        "media_collection_items.media_collection_id",
        "=",
        source.mediaCollectionId,
      )
      .orderBy("media_collection_items.position")
      .execute();
    return {
      kind: "collection",
      programmingBlockId: block.id,
      mediaCollectionId: source.mediaCollectionId,
      playbackMode: source.playbackMode,
      members: members.map(toScheduleMedia),
    };
  }

  const item = await selectScheduleMedia(trx)
    .where("media_items.id", "=", source.mediaItemId)
    .executeTakeFirstOrThrow();
  return {
    kind: "media_item",
    programmingBlockId: block.id,
    media: toScheduleMedia(item),
  };
}

// Starts a read of the item columns and metadata a ScheduleMedia needs,
// through the Media Library's join, so scheduling sees the facts it shows.
function selectScheduleMedia(trx: Executor) {
  return selectWithMetadata(trx)
    .select([
      "media_items.id",
      "media_items.title as item_title",
      "media_items.status",
      "media_items.duration_ms",
    ])
    .select(METADATA_COLUMNS);
}

/**
 * Loads the channel's progress through a collection in one playback mode,
 * starting from the beginning when that mode has none.
 */
export async function loadProgress(
  trx: Executor,
  channelId: string,
  mediaCollectionId: string,
  playbackMode: PlaybackMode,
): Promise<PlaybackProgress> {
  const row = await trx
    .selectFrom("channel_collection_progress")
    .select(["last_media_item_id", "last_position", "next_selection_index"])
    .where("channel_id", "=", channelId)
    .where("media_collection_id", "=", mediaCollectionId)
    .where("playback_mode", "=", playbackMode)
    .executeTakeFirst();
  return row === undefined
    ? NO_PROGRESS
    : {
        lastMediaItemId: row.last_media_item_id,
        lastPosition: row.last_position,
        nextSelectionIndex: row.next_selection_index,
      };
}

/** Inserts one chunk of generated entries in a single multi-row statement. */
export async function insertEntries(
  trx: Executor,
  channelId: string,
  entries: readonly GeneratedScheduleEntry[],
  createId: () => string,
  now: number,
): Promise<void> {
  if (entries.length === 0) return;
  await trx
    .insertInto("schedule_entries")
    .values(
      entries.map((entry) => ({
        id: createId(),
        channel_id: channelId,
        media_item_id: entry.mediaItemId,
        title: entry.title,
        starts_at: entry.startsAt,
        ends_at: entry.endsAt,
        duration_ms: entry.durationMs,
        sequence_number: entry.sequenceNumber,
        programming_block_id: entry.programmingBlockId,
        media_collection_id: entry.mediaCollectionId,
        playback_mode: entry.playbackMode,
        playback_index: entry.playbackIndex,
        created_at: now,
        updated_at: now,
      })),
    )
    .execute();
}

/** Finds the entry airing at `at`: started at or before it and not yet ended. */
export async function findEntryAiringAt(
  trx: Executor,
  channelId: string,
  at: number,
): Promise<{ startsAt: number; endsAt: number } | undefined> {
  const row = await trx
    .selectFrom("schedule_entries")
    .select(["starts_at", "ends_at"])
    .where("channel_id", "=", channelId)
    .where("starts_at", "<=", at)
    .where("ends_at", ">", at)
    .executeTakeFirst();
  return row === undefined
    ? undefined
    : { startsAt: row.starts_at, endsAt: row.ends_at };
}

/**
 * Deletes the channel's entries starting at or after `boundary` and returns
 * their collection bookkeeping, so regeneration can restore progress from
 * exactly what it removed.
 */
export async function deleteEntriesFrom(
  trx: Executor,
  channelId: string,
  boundary: number,
): Promise<RestorableEntry[]> {
  const rows = await trx
    .deleteFrom("schedule_entries")
    .where("channel_id", "=", channelId)
    .where("starts_at", ">=", boundary)
    .returning(RESTORABLE_COLUMNS)
    .execute();
  return rows.map(toRestorableEntry);
}

/**
 * Sets the channel's progress through each collection and mode the deleted
 * entries drew from to what the kept schedule implies, so
 * regenerated entries continue where it ends. Runs after the deletion, so
 * every entry still on the channel is a kept one.
 */
export async function restoreDeletedProgress(
  trx: Executor,
  channelId: string,
  deletedEntries: readonly RestorableEntry[],
  now: number,
): Promise<void> {
  const kept: RestorableEntry[] = [];
  const searched = new Set<string>();
  for (const { mediaCollectionId, playbackMode } of deletedEntries) {
    if (mediaCollectionId === null || playbackMode === null) continue;
    const key = JSON.stringify([mediaCollectionId, playbackMode]);
    if (searched.has(key)) continue;
    searched.add(key);
    const latest = await findLatestEntry(
      trx,
      channelId,
      mediaCollectionId,
      playbackMode,
    );
    if (latest !== undefined) kept.push(latest);
  }
  for (const restored of restorePlaybackProgress(deletedEntries, kept)) {
    await upsertProgress(
      trx,
      channelId,
      restored.mediaCollectionId,
      restored.playbackMode,
      restored.progress,
      now,
    );
  }
}

// Finds the channel's latest entry drawn from one collection in one mode.
async function findLatestEntry(
  trx: Executor,
  channelId: string,
  mediaCollectionId: string,
  playbackMode: PlaybackMode,
): Promise<RestorableEntry | undefined> {
  const row = await trx
    .selectFrom("schedule_entries")
    .select(RESTORABLE_COLUMNS)
    .where("channel_id", "=", channelId)
    .where("media_collection_id", "=", mediaCollectionId)
    .where("playback_mode", "=", playbackMode)
    .orderBy("sequence_number", "desc")
    .limit(1)
    .executeTakeFirst();
  return row === undefined ? undefined : toRestorableEntry(row);
}

/**
 * Records the channel's progress through a collection in one playback mode,
 * creating the row on first use. Never touches the reset marker.
 */
export async function upsertProgress(
  trx: Executor,
  channelId: string,
  mediaCollectionId: string,
  playbackMode: PlaybackMode,
  progress: PlaybackProgress,
  now: number,
): Promise<void> {
  const columns = {
    last_media_item_id: progress.lastMediaItemId,
    last_position: progress.lastPosition,
    next_selection_index: progress.nextSelectionIndex,
    updated_at: now,
  };
  await trx
    .insertInto("channel_collection_progress")
    .values({
      channel_id: channelId,
      media_collection_id: mediaCollectionId,
      playback_mode: playbackMode,
      ...columns,
    })
    .onConflict((conflict) =>
      conflict
        .columns(["channel_id", "media_collection_id", "playback_mode"])
        .doUpdateSet(columns),
    )
    .execute();
}

/** Creates a channel's state; its creation time is the mutation's effective time. */
export async function createScheduleState(
  trx: Executor,
  state: ScheduleState,
): Promise<void> {
  await trx
    .insertInto("channel_schedule_states")
    .values({ ...toStateColumns(state), created_at: state.updatedAt })
    .execute();
}

/** Overwrites a channel's state with the result of a mutation. */
export async function updateScheduleState(
  trx: Executor,
  state: ScheduleState,
): Promise<void> {
  await trx
    .updateTable("channel_schedule_states")
    .set(toStateColumns(state))
    .where("channel_id", "=", state.channelId)
    .execute();
}

/**
 * Lists the channel's entries overlapping `[start, end)` in start order. An
 * entry that only touches an edge does not overlap.
 */
export async function listEntriesInWindow(
  trx: Executor,
  channelId: string,
  start: number,
  end: number,
): Promise<ScheduleEntry[]> {
  const rows = await trx
    .selectFrom("schedule_entries")
    .selectAll()
    .where("channel_id", "=", channelId)
    .where("starts_at", "<", end)
    .where("ends_at", ">", start)
    .orderBy("starts_at")
    .execute();
  return rows.map(toScheduleEntry);
}

// The entry columns progress restoration reads.
const RESTORABLE_COLUMNS = [
  "sequence_number",
  "media_item_id",
  "media_collection_id",
  "playback_mode",
  "playback_index",
] as const;

// Keeps the entry row shape inside this module.
function toRestorableEntry(
  row: Pick<
    Selectable<ScheduleEntryTable>,
    (typeof RESTORABLE_COLUMNS)[number]
  >,
): RestorableEntry {
  return {
    sequenceNumber: row.sequence_number,
    mediaItemId: row.media_item_id,
    mediaCollectionId: row.media_collection_id,
    playbackMode: row.playback_mode,
    playbackIndex: row.playback_index,
  };
}

// Maps the domain state onto every column except `created_at`, which never changes.
function toStateColumns(state: ScheduleState) {
  return {
    channel_id: state.channelId,
    seed: state.seed,
    anchor_time: state.anchorTime,
    last_generated_through: state.lastGeneratedThrough,
    next_sequence_number: state.nextSequenceNumber,
    schedule_revision: state.scheduleRevision,
    updated_at: state.updatedAt,
  };
}

// Keeps the state row shape inside this module.
function toScheduleState(
  row: Selectable<ChannelScheduleStateTable>,
): ScheduleState {
  return {
    channelId: row.channel_id,
    seed: row.seed,
    anchorTime: row.anchor_time,
    lastGeneratedThrough: row.last_generated_through,
    nextSequenceNumber: row.next_sequence_number,
    scheduleRevision: row.schedule_revision,
    updatedAt: row.updated_at,
  };
}

// Keeps the entry row shape inside this module.
function toScheduleEntry(row: Selectable<ScheduleEntryTable>): ScheduleEntry {
  return {
    id: row.id,
    channelId: row.channel_id,
    mediaItemId: row.media_item_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMs: row.duration_ms,
    sequenceNumber: row.sequence_number,
    programmingBlockId: row.programming_block_id,
    mediaCollectionId: row.media_collection_id,
    playbackMode: row.playback_mode,
    playbackIndex: row.playback_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Narrows a collection member or single item to the facts kraziBrain
// schedules from, so both block sources hand it the same shape. Ordering
// facts go through effectiveMetadata and effectiveContentIdentity, so a
// correction wins here exactly as it does in the Media Library. An extra is
// never matched as an episode or movie, so it carries none.
function toScheduleMedia(
  row: MetadataColumns & {
    id: string;
    item_title: string;
    status: MediaItemStatus;
    duration_ms: number | null;
  },
): ScheduleMedia {
  const metadata = effectiveMetadata(row);
  const extra = metadata.matchState === "extra";
  return {
    id: row.id,
    title: row.item_title,
    status: row.status,
    durationMs: row.duration_ms,
    seriesTmdbId: extra ? null : effectiveContentIdentity(row).seriesTmdbId,
    seriesName: extra ? null : metadata.seriesName,
    seasonNumber: extra ? null : metadata.seasonNumber,
    episodeNumber: extra ? null : metadata.episodeNumber,
    releaseDate: extra ? null : metadata.releaseDate,
  };
}
