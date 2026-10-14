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
 * can show its basis without the browser knowing TMDB IDs. A series or
 * franchise is named by the same effective facts and rule as its picker, so
 * a card and the picker never disagree, or by its TMDB ID once no cataloged
 * item names it; a tag or genre is named by its own name. Reads only what the given
 * criteria need.
 */
export async function labelCriteria(
  executor: Kysely<DatabaseSchema>,
  criteria: readonly CollectionCriterion[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const tmdbCriteria = criteria.flatMap((criterion) =>
    criterion.kind === "tag" || criterion.kind === "genre" ? [] : [criterion],
  );
  // A genre is named by itself.
  for (const criterion of criteria) {
    if (criterion.kind === "genre") {
      labels.set(criterionKey(criterion), criterion.name);
    }
  }
  if (tmdbCriteria.length > 0) {
    const items = await readMatchableItems(executor);
    for (const kind of new Set(
      tmdbCriteria.map((criterion) => criterion.kind),
    )) {
      for (const group of listCatalogGroups(kind, items)) {
        labels.set(criterionKey({ kind, tmdbId: group.tmdbId }), group.name);
      }
    }
    for (const criterion of tmdbCriteria) {
      const key = criterionKey(criterion);
      if (!labels.has(key)) {
        labels.set(key, groupFallbackName(criterion.kind, criterion.tmdbId));
      }
    }
  }
  const tagIds = criteria.flatMap((criterion) =>
    criterion.kind === "tag" ? [criterion.tagId] : [],
  );
  if (tagIds.length > 0) {
    const tags = await executor
      .selectFrom("tags")
      .select(["id", "name"])
      .where("id", "in", tagIds)
      .execute();
    for (const tag of tags) {
      labels.set(criterionKey({ kind: "tag", tagId: tag.id }), tag.name);
    }
  }
  return labels;
}
