import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import {
  loadScheduleState,
  resetProgress,
} from "../schedules/schedule-repository.js";
import type { ProgressResetResult } from "./contracts.js";
import { toProgrammingBlockSource } from "./programming-block-repository.js";

/**
 * Restarts a block's channel, collection, and saved mode from the beginning,
 * inside the schedule transaction that then regenerates the channel. Every
 * block on the channel sharing that collection and mode shares the reset.
 * The first regenerated entry takes the channel's next sequence number, so
 * that number marks where post-reset entries begin.
 */
export async function resetBlockProgress(
  trx: Kysely<DatabaseSchema>,
  channelId: string,
  blockId: string,
  now: number,
): Promise<ProgressResetResult> {
  const block = await trx
    .selectFrom("programming_blocks")
    .selectAll()
    .where("channel_id", "=", channelId)
    .where("id", "=", blockId)
    .executeTakeFirst();
  if (block === undefined) return { kind: "not_found" };
  const source = toProgrammingBlockSource(block);
  if (source.kind !== "collection") return { kind: "single_item" };
  const state = await loadScheduleState(trx, channelId);
  await resetProgress(
    trx,
    channelId,
    source.mediaCollectionId,
    source.playbackMode,
    state?.nextSequenceNumber ?? 0,
    now,
  );
  return { kind: "reset" };
}
