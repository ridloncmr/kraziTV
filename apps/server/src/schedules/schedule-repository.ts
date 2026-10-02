import type {
  GeneratedScheduleEntry,
  PlaybackProgress,
  ScheduleMedia,
  ScheduleSource,
} from "@krazitv/krazi-brain";
import type { Kysely, Selectable } from "kysely";

import type { ChannelScheduleStateTable } from "../database/schema/channel-schedule-state-table.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import type { ScheduleEntryTable } from "../database/schema/schedule-entry-table.js";
import type { ScheduleEntry, ScheduleState } from "./contracts.js";

// Every function here takes the caller's executor: schedule mutations run
// only inside ScheduleService's immediate transactions, so each
// read-modify-write sees and commits one consistent state, and window reads
// run inside its deferred read snapshot.

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
  return row === undefined ? undefined : row.enabled === 1;
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

  if (block.media_collection_id !== null && block.playback_mode !== null) {
    const members = await trx
      .selectFrom("media_collection_items")
      .innerJoin(
        "media_items",
        "media_items.id",
        "media_collection_items.media_item_id",
      )
      .select([
        "media_items.id",
        "media_items.title",
        "media_items.status",
        "media_items.duration_ms",
      ])
      .where(
        "media_collection_items.media_collection_id",
        "=",
        block.media_collection_id,
      )
      .orderBy("media_collection_items.position")
      .execute();
    return {
      kind: "collection",
      programmingBlockId: block.id,
      mediaCollectionId: block.media_collection_id,
      playbackMode: block.playback_mode,
      members: members.map(toScheduleMedia),
    };
  }

  if (block.media_item_id !== null) {
    const item = await trx
      .selectFrom("media_items")
      .select(["id", "title", "status", "duration_ms"])
      .where("id", "=", block.media_item_id)
      .executeTakeFirstOrThrow();
    return {
      kind: "media_item",
      programmingBlockId: block.id,
      media: toScheduleMedia(item),
    };
  }
  throw new Error(`Programming block ${block.id} has a malformed source`);
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

// Narrows a catalog row to the facts kraziBrain schedules from.
function toScheduleMedia(
  row: Pick<MediaItemTable, "id" | "title" | "status" | "duration_ms">,
): ScheduleMedia {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    durationMs: row.duration_ms,
  };
}
