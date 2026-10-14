import {
  METADATA_PLAYBACK_MODES,
  orderFingerprint,
} from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ScheduleInputChange } from "../../schedules/contracts.js";
import {
  listMetadataOrderedBlocks,
  loadBlockSource,
  recordOrderFingerprint,
} from "../../schedules/schedule-repository.js";
import { readMatchableItems } from "../criteria/matchable-items.js";
import { reconcileCollection } from "./reconcile-collection.js";

/**
 * One maintenance pass as a schedule input change. Mode, criteria, and facts
 * are all read inside the change's immediate transaction, the same one the
 * membership is written in, so no decision committed before the pass can be
 * undone by it: a deleted or converted collection is simply not read, and a
 * removed item never matches. Membership is written, and its channels
 * named, only where it differs, so a pass that changes nothing regenerates
 * nothing and advances no schedule revision.
 */
export function maintenanceChange(): ScheduleInputChange<void> {
  return async (trx, now) => {
    const collections = await trx
      .selectFrom("media_collections")
      .select(["id", "criterion"])
      .where("maintenance_mode", "=", "automatic")
      .orderBy("id")
      .execute();
    if (collections.length === 0) {
      return { value: undefined, affectedChannelIds: [] };
    }
    const items = await readMatchableItems(trx);
    const affectedChannelIds: string[] = [];
    for (const collection of collections) {
      affectedChannelIds.push(
        ...(await reconcileCollection(trx, collection, items, now)),
      );
    }
    return { value: undefined, affectedChannelIds };
  };
}

/**
 * One check of every metadata-ordered block as a schedule input change.
 * Each block's order is recomputed from facts read inside the change's
 * immediate transaction and compared with the order its channel's schedule
 * recorded. Only a channel whose order differs is named and its new order
 * recorded, so a metadata write that changes no order regenerates nothing,
 * and a channel generation skips, such as a disabled one, is not checked
 * again until its order changes once more.
 */
export function orderingChange(): ScheduleInputChange<void> {
  return async (trx, now) => {
    const affectedChannelIds: string[] = [];
    for (const block of await listMetadataOrderedBlocks(trx)) {
      const source = await loadBlockSource(trx, block.channelId, block.blockId);
      if (source?.kind !== "collection") continue;
      const fingerprint = orderFingerprint(source.members, source.playbackMode);
      if (fingerprint === null || fingerprint === block.recordedFingerprint) {
        continue;
      }
      await recordOrderFingerprint(
        trx,
        block.channelId,
        source.mediaCollectionId,
        source.playbackMode,
        fingerprint,
        now,
      );
      affectedChannelIds.push(block.channelId);
    }
    return { value: undefined, affectedChannelIds };
  };
}

/**
 * Whether any block orders by metadata, read before taking write authority
 * so a channel lineup with none never queues behind the schedule lock.
 * Skipping is safe: a block given such a mode later records its order when
 * its schedule regenerates.
 */
export async function hasMetadataOrderedBlocks(
  db: Kysely<DatabaseSchema>,
): Promise<boolean> {
  const row = await db
    .selectFrom("programming_blocks")
    .select("id")
    .where("playback_mode", "in", METADATA_PLAYBACK_MODES)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Whether any collection is automatic, read before a pass takes write
 * authority so a catalog with none never queues behind the schedule lock.
 * Skipping is safe: a collection created after this read matched committed
 * facts in its own immediate transaction, so it is already current.
 */
export async function hasAutomaticCollections(
  db: Kysely<DatabaseSchema>,
): Promise<boolean> {
  const row = await db
    .selectFrom("media_collections")
    .select("id")
    .where("maintenance_mode", "=", "automatic")
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Records why a whole pass failed on every automatic collection, keeping
 * each one's last successful maintenance time, so a card shows how stale
 * its membership is. Runs outside the failed pass's rolled-back transaction.
 */
export async function recordMaintenanceFailure(
  db: Kysely<DatabaseSchema>,
  message: string,
): Promise<void> {
  await db
    .updateTable("media_collections")
    .set({ maintenance_error: message })
    .where("maintenance_mode", "=", "automatic")
    .execute();
}
