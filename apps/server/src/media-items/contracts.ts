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
}

/** The requested page plus the count of every item the search matches. */
export interface MediaItemPage {
  items: MediaItem[];
  total: number;
}
