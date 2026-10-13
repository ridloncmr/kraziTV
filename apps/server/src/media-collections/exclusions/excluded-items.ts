import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ExcludedItem } from "../contracts.js";
import { readStoredCriterion } from "../criteria/collection-criterion.js";
import { matchMembership } from "../criteria/match-criterion.js";
import { readMatchableItems } from "../criteria/matchable-items.js";
import { compareNames } from "../name-order.js";

/**
 * Lists the cataloged items excluded from a collection by title, each with
 * whether its criterion would include it were it restored, decided by the
 * same membership rule maintenance applies. Undefined for an unknown
 * collection; a removed item is no longer listed.
 */
export async function readExcludedItems(
  executor: Kysely<DatabaseSchema>,
  collectionId: string,
): Promise<ExcludedItem[] | undefined> {
  const collection = await executor
    .selectFrom("media_collections")
    .select("criterion")
    .where("id", "=", collectionId)
    .executeTakeFirst();
  if (collection === undefined) return undefined;
  const rows = await executor
    .selectFrom("media_collection_exclusions")
    .select("media_item_id")
    .where("media_collection_id", "=", collectionId)
    .execute();
  if (rows.length === 0) return [];
  const excluded = new Set(rows.map((row) => row.media_item_id));
  const items = await readMatchableItems(executor);
  const criterion =
    collection.criterion === null
      ? undefined
      : readStoredCriterion(collection.criterion);
  const qualifying = new Set(
    criterion === undefined
      ? []
      : matchMembership(criterion, items, [], []).members.map(
          (item) => item.id,
        ),
  );
  return items
    .filter((item) => excluded.has(item.id))
    .map((item) => ({
      mediaItemId: item.id,
      title: item.title,
      path: item.path,
      status: item.status,
      durationMs: item.durationMs,
      qualifies: qualifying.has(item.id),
    }))
    .sort((a, b) =>
      compareNames(
        { name: a.title, id: a.mediaItemId },
        { name: b.title, id: b.mediaItemId },
      ),
    );
}
