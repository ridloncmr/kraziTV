import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { seriesFallbackName } from "../criteria/catalog-series.js";
import type { CollectionCriterion } from "../contracts.js";
import { criterionKey } from "../criteria/collection-criterion.js";

/**
 * Names what each criterion matches on, keyed by `criterionKey`, so a card
 * can show its basis without the browser knowing TMDB IDs. Names come from
 * stored facts in one query per criterion kind; a series no stored fact
 * names any more reads by its TMDB ID.
 */
export async function labelCriteria(
  executor: Kysely<DatabaseSchema>,
  criteria: readonly CollectionCriterion[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const seriesIds = [...new Set(criteria.map((criterion) => criterion.tmdbId))];
  const named =
    seriesIds.length === 0
      ? []
      : await executor
          .selectFrom("content_facts")
          .select((eb) => [
            "series_tmdb_id",
            eb.fn.max("series_name").as("name"),
          ])
          .where("series_tmdb_id", "in", seriesIds)
          .groupBy("series_tmdb_id")
          .execute();
  for (const criterion of criteria) {
    const name = named.find((row) => row.series_tmdb_id === criterion.tmdbId);
    labels.set(
      criterionKey(criterion),
      name?.name ?? seriesFallbackName(criterion.tmdbId),
    );
  }
  return labels;
}
