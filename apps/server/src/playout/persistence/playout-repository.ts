import {
  assertFollowingCount,
  type PlayoutEntry,
  type Reservation,
} from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import { fromNullableSqliteBoolean } from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";

// Every query takes the caller's executor, so the snapshot read and the
// transition coordinator's immediate transaction run the same SQL. The inner
// join is safe: an entry's media item is a non-null foreign key, and catalog
// purge deletes an item only after deleting every entry that points at it,
// once all of them have ended.

type Executor = Kysely<DatabaseSchema>;

/**
 * Finds the entry covering `at` and the entry after it in sequence order,
 * the input current channel state needs. Returns nothing when no entry
 * covers `at`.
 */
export async function findCoveringPlayoutEntries(
  trx: Executor,
  channelId: string,
  at: number,
): Promise<PlayoutEntry[]> {
  const rows = await selectPlayoutEntries(trx, channelId)
    .where("schedule_entries.sequence_number", ">=", (eb) =>
      eb
        .selectFrom("schedule_entries")
        .select("sequence_number")
        .where("channel_id", "=", channelId)
        .where("starts_at", "<=", at)
        .where("ends_at", ">", at),
    )
    .orderBy("schedule_entries.sequence_number")
    .limit(2)
    .execute();
  return rows.map(toPlayoutEntry);
}

/**
 * Finds a program cursor's entry on its channel, where following selection
 * reads from. Undefined means the cursor is stale.
 */
export async function findPlayoutEntryById(
  trx: Executor,
  channelId: string,
  entryId: string,
): Promise<PlayoutEntry | undefined> {
  const row = await selectPlayoutEntries(trx, channelId)
    .where("schedule_entries.id", "=", entryId)
    .executeTakeFirst();
  return row === undefined ? undefined : toPlayoutEntry(row);
}

/**
 * Lists entries overlapping `[start, end)` in sequence order. An entry that
 * only touches an edge does not overlap.
 */
export async function listPlayoutEntriesInWindow(
  trx: Executor,
  channelId: string,
  start: number,
  end: number,
): Promise<PlayoutEntry[]> {
  const rows = await selectPlayoutEntries(trx, channelId)
    .where("schedule_entries.starts_at", "<", end)
    .where("schedule_entries.ends_at", ">", start)
    .orderBy("schedule_entries.sequence_number")
    .execute();
  return rows.map(toPlayoutEntry);
}

/**
 * Lists, in start order, the entry starting at or before `at` (the one
 * covering it, or else the last before it) and up to `after` entries
 * starting after it: what planned filler at or after `at` is derived from
 * (ADR 0014), however far the next entry is.
 */
export async function listPlayoutEntriesAround(
  trx: Executor,
  channelId: string,
  at: number,
  after: number,
): Promise<PlayoutEntry[]> {
  // SQLite reads a negative LIMIT as no limit, so a bad count fails here.
  assertFollowingCount(after);
  const latest = await selectPlayoutEntries(trx, channelId)
    .where("schedule_entries.starts_at", "<=", at)
    .orderBy("schedule_entries.starts_at", "desc")
    .limit(1)
    .execute();
  const later = await selectPlayoutEntries(trx, channelId)
    .where("schedule_entries.starts_at", ">", at)
    .orderBy("schedule_entries.starts_at")
    .limit(after)
    .execute();
  return [...latest, ...later].map(toPlayoutEntry);
}

/**
 * Lists the ranges of the channel's reservations ending after `after`, the
 * only ones that can explain filler from then on.
 */
export async function listReservedTimeRanges(
  trx: Executor,
  channelId: string,
  after: number,
): Promise<Pick<Reservation, "startsAt" | "endsAt">[]> {
  const rows = await trx
    .selectFrom("reservations")
    .select(["starts_at", "ends_at"])
    .where("channel_id", "=", channelId)
    .where("ends_at", ">", after)
    .orderBy("starts_at")
    .execute();
  return rows.map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at }));
}

// The channel's entries joined to the media columns a playout entry carries.
function selectPlayoutEntries(trx: Executor, channelId: string) {
  return trx
    .selectFrom("schedule_entries")
    .innerJoin(
      "media_items",
      "media_items.id",
      "schedule_entries.media_item_id",
    )
    .select([
      "schedule_entries.id",
      "schedule_entries.media_item_id",
      "schedule_entries.title",
      "schedule_entries.starts_at",
      "schedule_entries.ends_at",
      "schedule_entries.sequence_number",
      "schedule_entries.created_at",
      "schedule_entries.updated_at",
      "media_items.path",
      "media_items.status",
      "media_items.duration_ms",
      "media_items.has_audio",
      "media_items.has_video",
    ])
    .where("schedule_entries.channel_id", "=", channelId);
}

type PlayoutRow = Awaited<
  ReturnType<ReturnType<typeof selectPlayoutEntries>["executeTakeFirstOrThrow"]>
>;

// Keeps the joined row shape inside this module.
function toPlayoutEntry(row: PlayoutRow): PlayoutEntry {
  return {
    id: row.id,
    mediaItemId: row.media_item_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    media: {
      path: row.path,
      status: row.status,
      durationMs: row.duration_ms,
      hasAudio: fromNullableSqliteBoolean(row.has_audio),
      hasVideo: fromNullableSqliteBoolean(row.has_video),
    },
  };
}
