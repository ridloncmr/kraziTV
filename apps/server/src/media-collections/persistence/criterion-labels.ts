import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { CollectionCriterion } from "../contracts.js";
import {
  listCatalogSeries,
  seriesFallbackName,
} from "../criteria/catalog-series.js";
import { criterionKey } from "../criteria/collection-criterion.js";
import { readMatchableItems } from "../criteria/matchable-items.js";

/**
 * Names what each criterion matches on, keyed by `criterionKey`, so a card
 * can show its basis without the browser knowing TMDB IDs. Names come from
 * the same effective facts and naming rule as the series picker, so a card
 * and the picker never disagree; a series no cataloged item names reads by
 * its TMDB ID. Reads the catalog only when some criterion needs a name.
 */
export async function labelCriteria(
  executor: Kysely<DatabaseSchema>,
  criteria: readonly CollectionCriterion[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (criteria.length === 0) return labels;
  const names = new Map(
    listCatalogSeries(await readMatchableItems(executor)).map((series) => [
      series.tmdbId,
      series.name,
    ]),
  );
  for (const criterion of criteria) {
    labels.set(
      criterionKey(criterion),
      names.get(criterion.tmdbId) ?? seriesFallbackName(criterion.tmdbId),
    );
  }
  return labels;
}
