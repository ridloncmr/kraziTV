import type { Kysely } from "kysely";

import { toSqliteBoolean } from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ScheduleInputChange } from "../../schedules/contracts.js";
import { readStoredCriterion } from "../criteria/collection-criterion.js";
import { matchMembership } from "../criteria/match-criterion.js";
import { readMatchableItems } from "../criteria/matchable-items.js";
import { findChannelsUsingCollection } from "../persistence/channels-using-collection.js";
import { replaceCollectionMembers } from "../persistence/replace-collection-members.js";

const UNREADABLE_CRITERION =
  "This collection's saved criterion cannot be read, so it is not maintained";

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
      const criterion =
        collection.criterion === null
          ? undefined
          : readStoredCriterion(collection.criterion);
      if (criterion === undefined) {
        await recordError(trx, collection.id, UNREADABLE_CRITERION);
        continue;
      }
      const current = await memberIds(trx, collection.id);
      const { members, incomplete } = matchMembership(
        criterion,
        items,
        current,
      );
      const matched = members.map((item) => item.id);
      if (!sameOrder(current, matched)) {
        await replaceCollectionMembers(trx, collection.id, matched, now);
        affectedChannelIds.push(
          ...(await findChannelsUsingCollection(trx, collection.id)),
        );
      }
      await trx
        .updateTable("media_collections")
        .set({
          maintained_at: now,
          maintenance_error: null,
          maintenance_incomplete: toSqliteBoolean(incomplete),
        })
        .where("id", "=", collection.id)
        .execute();
    }
    return { value: undefined, affectedChannelIds };
  };
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

// Records one collection's own failure, leaving the others' passes alone.
async function recordError(
  trx: Kysely<DatabaseSchema>,
  id: string,
  message: string,
): Promise<void> {
  await trx
    .updateTable("media_collections")
    .set({ maintenance_error: message })
    .where("id", "=", id)
    .execute();
}

// A collection's current member IDs in position order.
async function memberIds(
  trx: Kysely<DatabaseSchema>,
  id: string,
): Promise<string[]> {
  const rows = await trx
    .selectFrom("media_collection_items")
    .select("media_item_id")
    .where("media_collection_id", "=", id)
    .orderBy("position")
    .execute();
  return rows.map((row) => row.media_item_id);
}

// Whether two ordered ID lists hold the same IDs in the same order.
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
