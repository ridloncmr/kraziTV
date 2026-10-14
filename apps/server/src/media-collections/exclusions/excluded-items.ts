import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ExcludedItem } from "../contracts.js";
import { readStoredCriterion } from "../criteria/collection-criterion.js";
import { knownMatch } from "../criteria/match-criterion.js";
import { readMatchableItems } from "../criteria/matchable-items.js";
import { compareNames } from "../name-order.js";

/** The IDs the owner keeps out of a collection, in no particular order. */
export async function readExcludedIds(
  executor: Kysely<DatabaseSchema>,
  collectionId: string,
): Promise<string[]> {
  const rows = await executor
    .selectFrom("media_collection_exclusions")
    .select("media_item_id")
    .where("media_collection_id", "=", collectionId)
    .execute();
  return rows.map((row) => row.media_item_id);
}

/**
 * Lists the cataloged items excluded from a collection by title, each with
 * whether its criterion would include it were it restored, decided by the
 * same match rule maintenance applies: null when expired TMDB data leaves
 * that unknown. Undefined for an unknown collection; a removed item is no
 * longer listed.
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
  const excluded = new Set(await readExcludedIds(executor, collectionId));
  if (excluded.size === 0) return [];
  const items = await readMatchableItems(executor);
  const criterion =
    collection.criterion === null
      ? undefined
      : readStoredCriterion(collection.criterion);
  return items
    .filter((item) => excluded.has(item.id))
    .map((item) => ({
      mediaItemId: item.id,
      title: item.title,
      path: item.path,
      status: item.status,
      durationMs: item.durationMs,
      qualifies: criterion === undefined ? false : knownMatch(criterion, item),
    }))
    .sort((a, b) =>
      compareNames(
        { name: a.title, id: a.mediaItemId },
        { name: b.title, id: b.mediaItemId },
      ),
    );
}
