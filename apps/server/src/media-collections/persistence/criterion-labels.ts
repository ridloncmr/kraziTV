import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { CollectionCriterion } from "../contracts.js";
import {
  groupFallbackName,
  listCatalogGroups,
} from "../criteria/catalog-groups.js";
import { criterionKey } from "../criteria/collection-criterion.js";
import { readMatchableItems } from "../criteria/matchable-items.js";

/**
 * Names what each criterion matches on, keyed by `criterionKey`, so a card
 * can show its basis without the browser knowing TMDB IDs. Names come from
 * the same effective facts and naming rule as the criterion pickers, so a
 * card and a picker never disagree; a group no cataloged item names reads
 * by its TMDB ID. Reads the catalog only when some criterion needs a name.
 */
export async function labelCriteria(
  executor: Kysely<DatabaseSchema>,
  criteria: readonly CollectionCriterion[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (criteria.length === 0) return labels;
  const items = await readMatchableItems(executor);
  const names = new Map<string, string>();
  for (const kind of new Set(criteria.map((criterion) => criterion.kind))) {
    for (const group of listCatalogGroups(kind, items)) {
      names.set(criterionKey({ kind, tmdbId: group.tmdbId }), group.name);
    }
  }
  for (const criterion of criteria) {
    const key = criterionKey(criterion);
    labels.set(key, names.get(key) ?? groupFallbackName(criterion));
  }
  return labels;
}
