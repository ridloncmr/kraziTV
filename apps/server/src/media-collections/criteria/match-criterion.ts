import type { CollectionCriterion } from "../contracts.js";
import { compareExact, compareText } from "../name-order.js";
import type { MatchableItem } from "../contracts.js";

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

/** The membership a criterion gives a collection, and whether part of it rests on unavailable evidence. */
interface Membership {
  members: MatchableItem[];
  /** An item whose TMDB data expired belongs or would match, so membership could not be confirmed. */
  incomplete: boolean;
}

/**
 * Decides a collection's membership from a criterion, cataloged facts, its
 * current member IDs, and its exclusions, in the collection's default saved
 * order. An excluded item is never a member, whether or not it matches. An item
 * whose TMDB data expired is unknown, never a confirmed mismatch: a current
 * member stays and a non-member is not added, and either case reports the
 * membership incomplete. Pure, so a preview, a creation, and a maintenance
 * pass given the same facts always agree.
 */
export function matchMembership(
  criterion: CollectionCriterion,
  items: readonly MatchableItem[],
  currentIds: readonly string[],
  excludedIds: readonly string[],
): Membership {
  const current = new Set(currentIds);
  const excluded = new Set(excludedIds);
  const { identity, order } = KINDS[criterion.kind];
  const members: MatchableItem[] = [];
  let incomplete = false;
  for (const item of items) {
    if (excluded.has(item.id)) continue;
    const matches = identity(item) === criterion.tmdbId;
    if (hasEvidence(item)) {
      if (matches) members.push(item);
    } else if (current.has(item.id)) {
      members.push(item);
      incomplete = true;
    } else if (matches) {
      incomplete = true;
    }
  }
  return { members: members.sort(order), incomplete };
}

/** Whether an item's provider facts are current enough to confirm or rule out a match. */
export function hasEvidence(item: MatchableItem): boolean {
  return !item.metadata.tmdbDataExpired;
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
