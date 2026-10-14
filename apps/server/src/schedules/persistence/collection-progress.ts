import {
  type CollectionProgress,
  METADATA_PLAYBACK_MODES,
  NO_PROGRESS,
  type PlaybackMode,
  type ProgressReset,
  type RestorableEntry,
  restorePlaybackProgress,
} from "@krazitv/krazi-brain";
import type { Insertable, Kysely } from "kysely";

import type { ChannelCollectionProgressTable } from "../../database/schema/channel-collection-progress-table.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { findLatestCollectionEntry } from "./schedule-repository.js";

// Every function here takes the caller's executor, as the schedule
// repository's do: progress is written only inside the schedule
// transaction that writes the entries it describes.

type Executor = Kysely<DatabaseSchema>;

/** One collection a channel plays in one playback mode. */
interface ProgressScope {
  channelId: string;
  mediaCollectionId: string;
  playbackMode: PlaybackMode;
}

/**
 * Loads the channel's progress through each collection and mode, leaving
 * out those it has none for, which start from the beginning.
 */
export async function loadProgress(
  trx: Executor,
  channelId: string,
  scopes: readonly Omit<ProgressScope, "channelId">[],
): Promise<CollectionProgress[]> {
  const loaded: CollectionProgress[] = [];
  for (const { mediaCollectionId, playbackMode } of scopes) {
    const row = await trx
      .selectFrom("channel_collection_progress")
      .select(["last_media_item_id", "last_position", "next_selection_index"])
      .where("channel_id", "=", channelId)
      .where("media_collection_id", "=", mediaCollectionId)
      .where("playback_mode", "=", playbackMode)
      .executeTakeFirst();
    if (row === undefined) continue;
    loaded.push({
      mediaCollectionId,
      playbackMode,
      progress: {
        lastMediaItemId: row.last_media_item_id,
        lastPosition: row.last_position,
        nextSelectionIndex: row.next_selection_index,
      },
    });
  }
  return loaded;
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
  const resets: ProgressReset[] = [];
  const searched = new Set<string>();
  for (const { mediaCollectionId, playbackMode } of deletedEntries) {
    if (mediaCollectionId === null || playbackMode === null) continue;
    const key = JSON.stringify([mediaCollectionId, playbackMode]);
    if (searched.has(key)) continue;
    searched.add(key);
    const latest = await findLatestCollectionEntry(
      trx,
      channelId,
      mediaCollectionId,
      playbackMode,
    );
    if (latest !== undefined) kept.push(latest);
    const reset = await trx
      .selectFrom("channel_collection_progress")
      .select("reset_sequence_number")
      .where("channel_id", "=", channelId)
      .where("media_collection_id", "=", mediaCollectionId)
      .where("playback_mode", "=", playbackMode)
      .executeTakeFirst();
    if (reset?.reset_sequence_number != null) {
      resets.push({
        mediaCollectionId,
        playbackMode,
        resetSequenceNumber: reset.reset_sequence_number,
      });
    }
  }
  for (const restored of restorePlaybackProgress(
    deletedEntries,
    kept,
    resets,
  )) {
    await upsertProgress(trx, channelId, restored, now);
  }
}

/**
 * Records the channel's progress through a collection in one playback mode,
 * creating the row on first use. Never touches the reset marker.
 */
export async function upsertProgress(
  trx: Executor,
  channelId: string,
  { mediaCollectionId, playbackMode, progress }: CollectionProgress,
  now: number,
): Promise<void> {
  await upsertProgressColumns(
    trx,
    { channelId, mediaCollectionId, playbackMode },
    {
      last_media_item_id: progress.lastMediaItemId,
      last_position: progress.lastPosition,
      next_selection_index: progress.nextSelectionIndex,
    },
    now,
  );
}

/**
 * Starts a channel's progress through a collection in one mode over from
 * the beginning, keeping random's seed, and marks the first entry generated
 * afterwards so restoration never returns to pre-reset progress.
 */
export async function resetProgress(
  trx: Executor,
  scope: ProgressScope,
  resetSequenceNumber: number,
  now: number,
): Promise<void> {
  await upsertProgressColumns(
    trx,
    scope,
    {
      last_media_item_id: NO_PROGRESS.lastMediaItemId,
      last_position: NO_PROGRESS.lastPosition,
      next_selection_index: NO_PROGRESS.nextSelectionIndex,
      reset_sequence_number: resetSequenceNumber,
    },
    now,
  );
}

/**
 * Records the order a channel's schedule follows for a collection in a
 * metadata mode, creating the progress row from the beginning on first
 * use. Never touches progress itself.
 */
export async function recordOrderFingerprint(
  trx: Executor,
  scope: ProgressScope,
  orderFingerprint: string,
  now: number,
): Promise<void> {
  await upsertProgressColumns(
    trx,
    scope,
    { order_fingerprint: orderFingerprint },
    now,
  );
}

// Writes `columns` to one channel, collection, and mode's progress row; a
// new row starts every column it is not given from the beginning.
async function upsertProgressColumns(
  trx: Executor,
  key: ProgressScope,
  columns: Partial<
    Pick<
      Insertable<ChannelCollectionProgressTable>,
      | "last_media_item_id"
      | "last_position"
      | "next_selection_index"
      | "reset_sequence_number"
      | "order_fingerprint"
    >
  >,
  now: number,
): Promise<void> {
  const written = { ...columns, updated_at: now };
  await trx
    .insertInto("channel_collection_progress")
    .values({
      channel_id: key.channelId,
      media_collection_id: key.mediaCollectionId,
      playback_mode: key.playbackMode,
      last_media_item_id: NO_PROGRESS.lastMediaItemId,
      last_position: NO_PROGRESS.lastPosition,
      next_selection_index: NO_PROGRESS.nextSelectionIndex,
      ...written,
    })
    .onConflict((conflict) =>
      conflict
        .columns(["channel_id", "media_collection_id", "playback_mode"])
        .doUpdateSet(written),
    )
    .execute();
}

/**
 * Lists every assigned collection a channel plays in a metadata mode, with
 * the order fingerprint its channel's schedule records, or null before one.
 */
export async function listMetadataOrderedMembers(
  trx: Executor,
): Promise<(ProgressScope & { recordedFingerprint: string | null })[]> {
  const rows = await trx
    .selectFrom("programming_assignment_members as member")
    .innerJoin(
      "programming_source_assignments as assignment",
      "assignment.id",
      "member.assignment_id",
    )
    .leftJoin("channel_collection_progress as progress", (join) =>
      join
        .onRef("progress.channel_id", "=", "member.channel_id")
        .onRef(
          "progress.media_collection_id",
          "=",
          "member.media_collection_id",
        )
        .onRef("progress.playback_mode", "=", "assignment.playback_mode"),
    )
    .select([
      "member.channel_id",
      "member.media_collection_id",
      "assignment.playback_mode",
      "progress.order_fingerprint",
    ])
    .where("assignment.playback_mode", "in", METADATA_PLAYBACK_MODES)
    .where("member.source_kind", "=", "collection")
    .orderBy("member.channel_id")
    .orderBy("member.media_collection_id")
    // A metadata-mode collection member always names both.
    .$narrowType<{ media_collection_id: string; playback_mode: PlaybackMode }>()
    .execute();
  return rows.map((row) => ({
    channelId: row.channel_id,
    mediaCollectionId: row.media_collection_id,
    playbackMode: row.playback_mode,
    recordedFingerprint: row.order_fingerprint,
  }));
}
