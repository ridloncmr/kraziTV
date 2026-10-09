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
  title: string | null;
  seriesName: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  /** The last episode a multi-episode file holds, else its only one. */
  lastEpisodeNumber: number | null;
  /** First release as `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`, keeping its precision. */
  releaseDate: string | null;
  genres: string[];
  franchiseName: string | null;
  description: string | null;
  /** TMDB's image path; the browser loads the image from TMDB. */
  posterPath: string | null;
  /** When the TMDB facts were fetched; null when the item has none. */
  refreshedAt: number | null;
}

/**
 * One page of the catalog listing; an empty `search` matches every item.
 * Excluded IDs are left out of both the page and `total`.
 */
export interface MediaItemQuery {
  search: string;
  limit: number;
  offset: number;
  excludeIds?: readonly string[];
  /** Keeps only items whose match needs the owner's choice. */
  needsChoice?: boolean;
}

/** The requested page plus the count of every item the search matches. */
export interface MediaItemPage {
  items: MediaItem[];
  total: number;
}
