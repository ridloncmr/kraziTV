import type { CatalogGroup, CollectionCriterion } from "../contracts.js";
import { compareExact, compareNames } from "../name-order.js";
import { hasEvidence, matchedIdentity } from "./match-criterion.js";
import type { MatchableItem } from "./matchable-items.js";

/**
 * Per criterion kind: the name items give the group they match, and the
 * name used once no cataloged item names it any more.
 */
const KINDS: Record<
  CollectionCriterion["kind"],
  {
    name: (item: MatchableItem) => string | null;
    fallback: (tmdbId: number) => string;
  }
> = {
  series: {
    name: (item) => item.metadata.seriesName,
    fallback: (tmdbId) => `TMDB series ${tmdbId}`,
  },
  franchise: {
    name: (item) => item.metadata.franchiseName,
    fallback: (tmdbId) => `TMDB collection ${tmdbId}`,
  },
};

/**
 * Groups cataloged items by the identity a criterion of `kind` matches on,
 * so each count equals the membership its collection would get. Pickers and
 * card labels name a group this one way: the greatest effective name among
 * its items, so the choice never depends on read order. Sorted by name.
 */
export function listCatalogGroups(
  kind: CollectionCriterion["kind"],
  items: readonly MatchableItem[],
): CatalogGroup[] {
  const { name, fallback } = KINDS[kind];
  const groups = new Map<number, { names: string[]; itemCount: number }>();
  for (const item of items) {
    const tmdbId = matchedIdentity(kind, item);
    // Counted only where creation would include it.
    if (tmdbId === null || !hasEvidence(item)) continue;
    const group = groups.get(tmdbId) ?? { names: [], itemCount: 0 };
    group.itemCount += 1;
    const itemName = name(item);
    if (itemName !== null) group.names.push(itemName);
    groups.set(tmdbId, group);
  }
  return [...groups]
    .map(([tmdbId, { names, itemCount }]) => ({
      tmdbId,
      name: names.sort(compareExact).at(-1) ?? fallback(tmdbId),
      itemCount,
    }))
    .sort((a, b) =>
      compareNames(
        { name: a.name, id: a.tmdbId },
        { name: b.name, id: b.tmdbId },
      ),
    );
}

/** Names a group no cataloged item names any more, so it still reads as one. */
export function groupFallbackName(criterion: CollectionCriterion): string {
  return KINDS[criterion.kind].fallback(criterion.tmdbId);
}
