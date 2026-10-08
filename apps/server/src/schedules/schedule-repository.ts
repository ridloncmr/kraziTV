import {
  type GeneratedScheduleEntry,
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
import type { MediaCollectionMember } from "../media-collections/contracts.js";
import { selectMembers } from "../media-collections/media-collection-repository.js";
import { toProgrammingBlockSource } from "../programming-blocks/programming-block-repository.js";
import type { ScheduleEntry, ScheduleState } from "./contracts.js";

// Every function here takes the caller's executor: schedule mutations run
// only inside immediate transactions, ScheduleService's or catalog purge's,
// so each read-modify-write sees and commits one consistent state, and window
// reads run inside a deferred read snapshot.

type Executor = Kysely<DatabaseSchema>;

/** Progress for a collection the channel has never played. */
export const NO_PROGRESS: PlaybackProgress = {
  nextChronologicalPosition: 0,
  nextRandomSelectionIndex: 0,
};

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
 * collection members in membership order, or the single item. Returns
 * undefined when the channel has no block.
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
    const members = await selectMembers(trx, source.mediaCollectionId);
    return {
      kind: "collection",
      programmingBlockId: block.id,
      mediaCollectionId: source.mediaCollectionId,
      playbackMode: source.playbackMode,
      members: members.map(toScheduleMedia),
    };
  }

  const item = await trx
    .selectFrom("media_items")
    .select([
      "id as mediaItemId",
      "title",
      "status",
      "duration_ms as durationMs",
    ])
    .where("id", "=", source.mediaItemId)
    .executeTakeFirstOrThrow();
  return {
    kind: "media_item",
    programmingBlockId: block.id,
    media: toScheduleMedia(item),
  };
}

/** Loads the channel's progress through a collection, starting at zero when it has none. */
export async function loadProgress(
  trx: Executor,
  channelId: string,
  mediaCollectionId: string,
): Promise<PlaybackProgress> {
  const row = await trx
    .selectFrom("channel_collection_progress")
    .select(["next_chronological_position", "next_random_selection_index"])
    .where("channel_id", "=", channelId)
    .where("media_collection_id", "=", mediaCollectionId)
    .executeTakeFirst();
  return row === undefined
    ? NO_PROGRESS
    : {
        nextChronologicalPosition: row.next_chronological_position,
        nextRandomSelectionIndex: row.next_random_selection_index,
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
    .returning([
      "sequence_number",
      "media_collection_id",
      "playback_mode",
      "playback_index",
    ])
    .execute();
  return rows.map((row) => ({
    sequenceNumber: row.sequence_number,
    mediaCollectionId: row.media_collection_id,
    playbackMode: row.playback_mode,
    playbackIndex: row.playback_index,
  }));
}

/**
 * Rewinds the channel's progress through each collection the deleted entries
 * drew from, so regenerated entries continue where the kept schedule ends.
 */
export async function restoreDeletedProgress(
  trx: Executor,
  channelId: string,
  deletedEntries: readonly RestorableEntry[],
  now: number,
): Promise<void> {
  const current = new Map<string, PlaybackProgress>();
  for (const { mediaCollectionId } of deletedEntries) {
    if (mediaCollectionId === null || current.has(mediaCollectionId)) continue;
    current.set(
      mediaCollectionId,
      await loadProgress(trx, channelId, mediaCollectionId),
    );
  }
  const restored = restorePlaybackProgress(current, deletedEntries);
  for (const [mediaCollectionId, progress] of restored) {
    await upsertProgress(trx, channelId, mediaCollectionId, progress, now);
  }
}

/** Records the channel's progress through a collection, creating the row on first use. */
export async function upsertProgress(
  trx: Executor,
  channelId: string,
  mediaCollectionId: string,
  progress: PlaybackProgress,
  now: number,
): Promise<void> {
  const columns = {
    next_chronological_position: progress.nextChronologicalPosition,
    next_random_selection_index: progress.nextRandomSelectionIndex,
    updated_at: now,
  };
  await trx
    .insertInto("channel_collection_progress")
    .values({
      channel_id: channelId,
      media_collection_id: mediaCollectionId,
      ...columns,
    })
    .onConflict((conflict) =>
      conflict
        .columns(["channel_id", "media_collection_id"])
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
// schedules from, so both block sources hand it the same shape.
function toScheduleMedia(
  media: Pick<
    MediaCollectionMember,
    "mediaItemId" | "title" | "status" | "durationMs"
  >,
): ScheduleMedia {
  return {
    id: media.mediaItemId,
    title: media.title,
    status: media.status,
    durationMs: media.durationMs,
  };
}
