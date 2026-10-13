import type { CatalogSeries } from "../contracts.js";
import { compareNames } from "../name-order.js";
import type { MatchableItem } from "./matchable-items.js";

/**
 * Groups cataloged items by the series identity criteria match on, so each
 * count equals the membership a series collection would get. A series whose
 * items all lost their names to expiry is named by its TMDB ID.
 */
export function listCatalogSeries(
  items: readonly MatchableItem[],
): CatalogSeries[] {
  const series = new Map<number, CatalogSeries>();
  for (const item of items) {
    const tmdbId = item.identity.seriesTmdbId;
    if (tmdbId === null) continue;
    const entry = series.get(tmdbId) ?? {
      tmdbId,
      name: seriesFallbackName(tmdbId),
      itemCount: 0,
    };
    entry.itemCount += 1;
    if (item.metadata.seriesName !== null)
      entry.name = item.metadata.seriesName;
    series.set(tmdbId, entry);
  }
  return [...series.values()].sort((a, b) =>
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
