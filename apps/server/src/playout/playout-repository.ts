import { assertFollowingCount, type PlayoutEntry } from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import { fromSqliteBoolean } from "../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { SequencedPlayoutEntry } from "./contracts.js";

// Every query takes the caller's executor, so the snapshot read and the
// transition coordinator's immediate transaction run the same SQL. The inner
// join is safe: an entry's media item is a non-null foreign key and
// production never deletes media items.

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
 * Finds a playout cursor's entry on its channel with the sequence number the
 * following query continues from. Undefined means the cursor is stale.
 */
export async function findPlayoutEntryById(
  trx: Executor,
  channelId: string,
  entryId: string,
): Promise<SequencedPlayoutEntry | undefined> {
  const row = await selectPlayoutEntries(trx, channelId)
    .where("schedule_entries.id", "=", entryId)
    .executeTakeFirst();
  return row === undefined
    ? undefined
    : { entry: toPlayoutEntry(row), sequenceNumber: row.sequence_number };
}

/**
 * Lists up to `count` entries after a sequence number, in sequence order.
 * Rejects a count that is not a positive integer as a programming error,
 * because SQLite reads a negative LIMIT as no limit at all.
 */
export async function listPlayoutEntriesAfter(
  trx: Executor,
  channelId: string,
  sequenceNumber: number,
  count: number,
): Promise<PlayoutEntry[]> {
  assertFollowingCount(count);
  const rows = await selectPlayoutEntries(trx, channelId)
    .where("schedule_entries.sequence_number", ">", sequenceNumber)
    .orderBy("schedule_entries.sequence_number")
    .limit(count)
    .execute();
  return rows.map(toPlayoutEntry);
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
      hasAudio:
        row.has_audio === null ? null : fromSqliteBoolean(row.has_audio),
    },
  };
}
