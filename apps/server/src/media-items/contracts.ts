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
