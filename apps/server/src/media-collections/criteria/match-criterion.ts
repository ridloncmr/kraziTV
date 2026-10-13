import type { CollectionCriterion } from "../contracts.js";
import { compareExact, compareText } from "../name-order.js";
import type { MatchableItem } from "./matchable-items.js";

type Order = (a: MatchableItem, b: MatchableItem) => number;

/**
 * Per criterion kind: the identity an item must share with the criterion,
 * and the collection's default saved order. A series and a franchise stay
 * separate criteria even when their TMDB IDs or items overlap.
 */
const KINDS: Record<
  CollectionCriterion["kind"],
  { identity: (item: MatchableItem) => number | null; order: Order }
> = {
  series: {
    identity: (item) => item.identity.seriesTmdbId,
    order: episodeOrder,
  },
  franchise: {
    identity: (item) => item.identity.franchiseTmdbId,
    order: releaseOrder,
  },
};

/**
 * The TMDB identity an item has for a criterion of `kind`, or null when it
 * has none. Pickers group by this, so their counts equal what matching
 * would include.
 */
export function matchedIdentity(
  kind: CollectionCriterion["kind"],
  item: MatchableItem,
): number | null {
  return KINDS[kind].identity(item);
}

/**
 * Returns the items a criterion matches, in the collection's default saved
 * order. Pure, so a preview, a creation, and a maintenance pass given the
 * same facts always agree on membership and order.
 */
export function matchCriterion(
  criterion: CollectionCriterion,
  items: readonly MatchableItem[],
): MatchableItem[] {
  const { identity, order } = KINDS[criterion.kind];
  return items
    .filter((item) => identity(item) === criterion.tmdbId)
    .sort(order);
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

/**
 * Movie-group order: release date, then title, then path, then ID. Dates
 * keep their precision and compare as text, so a year-only date sorts at
 * the start of its year; an unknown date sorts after every known one.
 */
function releaseOrder(a: MatchableItem, b: MatchableItem): number {
  return (
    compareKnownFirst(a.metadata.releaseDate, b.metadata.releaseDate) ||
    compareText(a.metadata.title ?? a.title, b.metadata.title ?? b.title) ||
    compareExact(a.path, b.path) ||
    compareExact(a.id, b.id)
  );
}

// Orders known values ascending with null after every known value.
function compareKnownFirst<T extends string | number>(
  a: T | null,
  b: T | null,
): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareExact(a, b);
}
