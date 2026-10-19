import type { MediaItemStatus } from "../database/schema/media-item-table.js";

export interface MediaItem {
  id: string;
  mediaRootId: string;
  path: string;
  title: string;
  durationMs: number | null;
  hasAudio: boolean | null;
  /** Null for items cataloged before video detection, until their next scan. */
  hasVideo: boolean | null;
  status: MediaItemStatus;
  probeError: string | null;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  lastProbedAt: number | null;
  metadata: ContentMetadata;
}

/**
 * Where an item's content identification stands. `not_looked_up` has no
 * decision yet; `extra` is bonus material that is never matched.
 */
type MatchState =
  | "not_looked_up"
  | "unmatched"
  | "ambiguous"
  | "matched"
  | "rejected"
  | "extra";

/** An item's effective content metadata; unknown facts are null. */
export interface ContentMetadata {
  matchState: MatchState;
  /** Why the last lookup failed; the item stays `unmatched`. */
  lookupError: string | null;
  /**
   * True for a matched item whose probed duration moved more than 2 seconds
   * from its match-time duration; the match and corrections stay.
   */
  fileChanged: boolean;
  title: string | null;
  seriesName: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  /** The last episode a multi-episode file holds, else its only one. */
  lastEpisodeNumber: number | null;
  /** First release as `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`, keeping its precision. */
  releaseDate: string | null;
  /**
   * True for an episode matched to a series whose TMDB season does not list
   * it, as when TMDB and TVDB number a season differently; its season and
   * episode numbers are the file's own.
   */
  episodeUnlisted: boolean;
  genres: string[];
  franchiseName: string | null;
  description: string | null;
  /** TMDB's image path; the browser loads the image from TMDB. */
  posterPath: string | null;
  /** When the TMDB facts were fetched; null when the item has none. */
  refreshedAt: number | null;
  /** Why the last background refresh failed; the match stays. */
  refreshError: string | null;
  /** True once TMDB facts went six months unrefreshed and were dropped. */
  tmdbDataExpired: boolean;
  /** The owner's tags and themes; TMDB never sets them. */
  tags: string[];
  /** Fields whose value is the owner's correction, which TMDB never changes. */
  correctedFields: CorrectableField[];
}

/** The TMDB series or franchise an item's content belongs to, null when none is known, and the owner's tags on it. */
export interface ContentIdentity {
  seriesTmdbId: number | null;
  franchiseTmdbId: number | null;
  tagIds: string[];
}

/** A content fact the owner can correct over what TMDB says. */
export type CorrectableField =
  "title" | "seriesName" | "seasonNumber" | "episodeNumber" | "releaseYear";

/**
 * One page of the catalog listing; an empty `search` matches every item.
 * Excluded IDs are left out of both the page and `total`.
 */
export interface MediaItemQuery {
  search: string;
  limit: number;
  offset: number;
  excludeIds?: readonly string[];
  filter?: CatalogFilter;
}

/**
 * A match state a list can filter on: an item's effective state, where
 * `unmatched` means TMDB answered without a match and `lookup_failed` means
 * the last lookup failed, though both items report `unmatched`. A matched
 * item whose file changed or whose episode TMDB does not list is also
 * `file_changed` or `episode_unlisted`. An extra is a type, never a match
 * state here, since it is never looked up.
 */
export type MatchStateFilter =
  | Exclude<MatchState, "extra">
  | "lookup_failed"
  | "file_changed"
  | "episode_unlisted";

/**
 * What an item is: a movie or episode by its accepted facts, an extra, or
 * unidentified when it is neither an extra nor known as either.
 */
export type ContentTypeFilter = "movie" | "episode" | "extra" | "unidentified";

/**
 * A fact about an item's metadata worth finding across the catalog: the
 * owner corrected it, its TMDB data expired, or its last refresh failed.
 */
export type MetadataDetailFilter =
  "corrected" | "tmdb_expired" | "refresh_failed";

/**
 * What a list keeps: an item matching any value of each non-empty field,
 * and every field at once. An absent or empty field keeps every item.
 */
export interface CatalogFilter {
  matchStates?: readonly MatchStateFilter[];
  contentTypes?: readonly ContentTypeFilter[];
  details?: readonly MetadataDetailFilter[];
  /** `none` keeps items that belong to no media collection. */
  collections?: readonly "none"[];
  statuses?: readonly MediaItemStatus[];
  mediaRootIds?: readonly string[];
  seriesTmdbIds?: readonly number[];
  franchiseTmdbIds?: readonly number[];
  genres?: readonly string[];
  tagIds?: readonly string[];
}

/**
 * One root's match counts over its cataloged items, extras included in
 * `items`. `failedLookups` counts exactly what a failed-lookup retry of the
 * root would look up.
 */
export interface RootMatchCounts {
  items: number;
  matched: number;
  needsChoice: number;
  failedLookups: number;
}

/** The requested page plus the count of every item the search matches. */
export interface MediaItemPage {
  items: MediaItem[];
  total: number;
}
