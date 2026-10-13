import type { CatalogSeries } from "../contracts.js";
import { compareExact, compareNames } from "../name-order.js";
import type { MatchableItem } from "./matchable-items.js";

/**
 * Groups cataloged items by the series identity criteria match on, so each
 * count equals the membership a series collection would get. The picker and
 * every card label name a series this one way: the greatest effective name
 * among its items, so the choice never depends on read order. A series
 * whose items all lost their names to expiry is named by its TMDB ID.
 */
export function listCatalogSeries(
  items: readonly MatchableItem[],
): CatalogSeries[] {
  const series = new Map<number, { names: string[]; itemCount: number }>();
  for (const item of items) {
    const tmdbId = item.identity.seriesTmdbId;
    if (tmdbId === null) continue;
    const entry = series.get(tmdbId) ?? { names: [], itemCount: 0 };
    entry.itemCount += 1;
    if (item.metadata.seriesName !== null) {
      entry.names.push(item.metadata.seriesName);
    }
    series.set(tmdbId, entry);
  }
  return [...series]
    .map(([tmdbId, { names, itemCount }]) => ({
      tmdbId,
      name: names.sort(compareExact).at(-1) ?? seriesFallbackName(tmdbId),
      itemCount,
    }))
    .sort((a, b) =>
      compareNames(
        { name: a.name, id: a.tmdbId },
        { name: b.name, id: b.tmdbId },
      ),
    );
}

/** Names a series no cataloged item names any more, so it still reads as one. */
export function seriesFallbackName(tmdbId: number): string {
  return `TMDB series ${tmdbId}`;
}
