import type { Kysely } from "kysely";

import { toSqliteBoolean } from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { readStoredCriterion } from "../criteria/collection-criterion.js";
import { matchMembership } from "../criteria/match-criterion.js";
import type { MatchableItem } from "../contracts.js";
import { findChannelsUsingCollection } from "../persistence/channels-using-collection.js";
import { replaceCollectionMembers } from "../persistence/replace-collection-members.js";

const UNREADABLE_CRITERION =
  "This collection's saved criterion cannot be read, so it is not maintained";

/**
 * Brings one automatic collection's membership in line with its criterion,
 * exclusions, and `items`, inside the caller's schedule transaction, and
 * records the result. Membership is written, and channels named, only when
 * it differs, so an unchanged collection regenerates nothing. Returns the
 * channels drawing from it whose schedules must regenerate.
 */
export async function reconcileCollection(
  trx: Kysely<DatabaseSchema>,
  collection: { id: string; criterion: string | null },
  items: readonly MatchableItem[],
  now: number,
): Promise<string[]> {
  const criterion =
    collection.criterion === null
      ? undefined
      : readStoredCriterion(collection.criterion);
  if (criterion === undefined) {
    await recordError(trx, collection.id, UNREADABLE_CRITERION);
    return [];
  }
  const current = await memberIds(trx, collection.id);
  const { members, incomplete } = matchMembership(
    criterion,
    items,
    current,
    await excludedIds(trx, collection.id),
  );
  const matched = members.map((item) => item.id);
  const changed = !sameOrder(current, matched);
  if (changed) {
    await replaceCollectionMembers(trx, collection.id, matched, now);
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
  return changed ? findChannelsUsingCollection(trx, collection.id) : [];
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

// The items the owner keeps out of a collection.
async function excludedIds(
  trx: Kysely<DatabaseSchema>,
  id: string,
): Promise<string[]> {
  const rows = await trx
    .selectFrom("media_collection_exclusions")
    .select("media_item_id")
    .where("media_collection_id", "=", id)
    .execute();
  return rows.map((row) => row.media_item_id);
}

// Whether two ordered ID lists hold the same IDs in the same order.
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
