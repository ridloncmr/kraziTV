import type { CollectionCriterion } from "../contracts.js";
import { compareExact } from "../name-order.js";
import type { MatchableItem } from "./matchable-items.js";

/**
 * Returns the items a criterion matches, in the collection's default saved
 * order. Pure, so a preview, a creation, and a maintenance pass given the
 * same facts always agree on membership and order.
 */
export function matchCriterion(
  criterion: CollectionCriterion,
  items: readonly MatchableItem[],
): MatchableItem[] {
  return items
    .filter((item) => item.identity.seriesTmdbId === criterion.tmdbId)
    .sort(episodeOrder);
}

/**
 * Series order: season, then episode, then path, with ID as the last tie so
 * duplicate files of one episode keep a stable order. Unknown numbers sort
 * after every known one rather than guessing a position.
 */
function episodeOrder(a: MatchableItem, b: MatchableItem): number {
  return (
    compareKnownFirst(a.metadata.seasonNumber, b.metadata.seasonNumber) ||
    compareKnownFirst(a.metadata.episodeNumber, b.metadata.episodeNumber) ||
    compareExact(a.path, b.path) ||
    compareExact(a.id, b.id)
  );
}

// Orders numbers ascending with null after every number.
function compareKnownFirst(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}
