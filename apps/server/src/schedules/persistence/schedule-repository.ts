import type {
  GeneratedScheduleEntry,
  PlaybackMode,
  RestorableEntry,
} from "@krazitv/krazi-brain";
import type { Kysely, Selectable } from "kysely";

import {
  fromSqliteBoolean,
  toSqliteBoolean,
} from "../../database/columns/sqlite-boolean.js";
import type { ChannelScheduleStateTable } from "../../database/schema/channel-schedule-state-table.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ScheduleEntryTable } from "../../database/schema/schedule-entry-table.js";
import type { ScheduleEntry, ScheduleState } from "../contracts.js";

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
 * Lists up to `limit` of the channel's entries drawn from one collection in
 * one mode, starting at or after `from`, in start order: the selections
 * that collection airs next.
 */
export async function listUpcomingCollectionEntries(
  trx: Executor,
  channelId: string,
  source: { mediaCollectionId: string; playbackMode: PlaybackMode },
  from: number,
  limit: number,
): Promise<ScheduleEntry[]> {
  const rows = await trx
    .selectFrom("schedule_entries")
    .selectAll()
    .where("channel_id", "=", channelId)
    .where("media_collection_id", "=", source.mediaCollectionId)
    .where("playback_mode", "=", source.playbackMode)
    .where("starts_at", ">=", from)
    .orderBy("starts_at")
    .limit(limit)
    .execute();
  return rows.map(toScheduleEntry);
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

/** Finds the channel's latest entry drawn from one collection in one mode. */
export async function findLatestCollectionEntry(
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

// Maps the domain state onto every column it owns. `created_at` never
// changes, and the last rebuild key is written only by a fresh rebuild.
function toStateColumns(state: ScheduleState) {
  return {
    channel_id: state.channelId,
    seed: state.seed,
    anchor_time: state.anchorTime,
    last_generated_through: state.lastGeneratedThrough,
    next_sequence_number: state.nextSequenceNumber,
    schedule_revision: state.scheduleRevision,
    programming_seed: state.programmingSeed,
    rebuild_count: state.rebuildCount,
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
    programmingSeed: row.programming_seed,
    rebuildCount: row.rebuild_count,
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
