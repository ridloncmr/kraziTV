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

/**
 * Lists the collection bookkeeping of the channel's entries starting at or
 * after `boundary`: what a regeneration from there would delete, read
 * without deleting, for a preview.
 */
export async function listRestorableEntriesFrom(
  trx: Executor,
  channelId: string,
  boundary: number,
): Promise<RestorableEntry[]> {
  const rows = await trx
    .selectFrom("schedule_entries")
    .select(RESTORABLE_COLUMNS)
    .where("channel_id", "=", channelId)
    .where("starts_at", ">=", boundary)
    .execute();
  return rows.map(toRestorableEntry);
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
 * Deletes the entries a withdrawn cut left behind: a reservation block's
 * entry starting after `now` whose reservation is gone or now starts later
 * (ADR 0015). Left in place, they would hide the restored airing item from
 * the regeneration boundary; every other entry stays for that regeneration
 * to judge. Returns what it deleted so progress is restored with the rest.
 */
export async function deleteWithdrawnCutEntries(
  trx: Executor,
  channelId: string,
  now: number,
): Promise<RestorableEntry[]> {
  const rows = await trx
    .deleteFrom("schedule_entries")
    .where("channel_id", "=", channelId)
    .where("starts_at", ">", now)
    .where("id", "in", (eb) =>
      eb
        .selectFrom("schedule_entries as stale")
        .innerJoin(
          "programming_blocks",
          "programming_blocks.id",
          "stale.programming_block_id",
        )
        .leftJoin(
          "reservations",
          "reservations.id",
          "programming_blocks.reservation_id",
        )
        .select("stale.id")
        .where("stale.channel_id", "=", channelId)
        .where("programming_blocks.reservation_id", "is not", null)
        .where((inner) =>
          inner.or([
            inner("reservations.id", "is", null),
            inner("reservations.starts_at", ">", inner.ref("stale.starts_at")),
          ]),
        ),
    )
    .returning(RESTORABLE_COLUMNS)
    .execute();
  return rows.map(toRestorableEntry);
}

/**
 * Finds the channel's latest entry drawn from one collection in one mode,
 * among those starting before `before` when it is given.
 */
export async function findLatestCollectionEntry(
  trx: Executor,
  channelId: string,
  mediaCollectionId: string,
  playbackMode: PlaybackMode,
  before?: number,
): Promise<RestorableEntry | undefined> {
  let query = trx
    .selectFrom("schedule_entries")
    .select(RESTORABLE_COLUMNS)
    .where("channel_id", "=", channelId)
    .where("media_collection_id", "=", mediaCollectionId)
    .where("playback_mode", "=", playbackMode);
  if (before !== undefined) query = query.where("starts_at", "<", before);
  const row = await query
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

/**
 * Records a fresh rebuild requested under `key` before it regenerates:
 * advances the rebuild count once and remembers the key, so a retry with
 * the same key is reported `repeated` and advances nothing. A channel with
 * no schedule yet has no programming to clear, so it is `unscheduled`.
 */
export async function recordFreshRebuild(
  trx: Executor,
  channelId: string,
  key: string,
): Promise<"advanced" | "repeated" | "unscheduled"> {
  const row = await trx
    .selectFrom("channel_schedule_states")
    .select(["rebuild_count", "last_rebuild_key"])
    .where("channel_id", "=", channelId)
    .executeTakeFirst();
  if (row === undefined) return "unscheduled";
  if (row.last_rebuild_key === key) return "repeated";
  await trx
    .updateTable("channel_schedule_states")
    .set({ rebuild_count: row.rebuild_count + 1, last_rebuild_key: key })
    .where("channel_id", "=", channelId)
    .execute();
  return "advanced";
}

/**
 * Remembers a fresh rebuild's key on a schedule its own commit created, so
 * a retry is still recognized; the count stays where the first schedule
 * started it.
 */
export async function recordRebuildKey(
  trx: Executor,
  channelId: string,
  key: string,
): Promise<void> {
  await trx
    .updateTable("channel_schedule_states")
    .set({ last_rebuild_key: key })
    .where("channel_id", "=", channelId)
    .execute();
}

/**
 * Advances a channel's schedule revision once for a commit that changed
 * planned transmission without regenerating it, such as a purge of ended
 * entries or a reservation write whose regeneration changed no entry (ADR
 * 0014). The programming revision advances with it only when the commit
 * changed what a reservation preview shows: a reservation write does, a
 * purge of ended entries does not. A channel without a schedule has no
 * revision to advance.
 */
export async function advanceScheduleRevision(
  trx: Executor,
  channelId: string,
  now: number,
  { programmingChanged }: { programmingChanged: boolean },
): Promise<void> {
  const state = await loadScheduleState(trx, channelId);
  if (state === undefined) return;
  await updateScheduleState(trx, {
    ...state,
    scheduleRevision: state.scheduleRevision + 1,
    programmingRevision:
      state.programmingRevision + (programmingChanged ? 1 : 0),
    // Never earlier than the last mutation, so the clamp stays monotonic.
    updatedAt: Math.max(state.updatedAt, now),
  });
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
    programming_revision: state.programmingRevision,
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
    programmingRevision: row.programming_revision,
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
