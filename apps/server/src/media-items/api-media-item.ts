import { toApiTimestamp, toApiTimestampOrNull } from "../http/api-timestamp.js";
import type { MediaItem } from "./contracts.js";

/**
 * Projects an item as the API promises it, converting internal epoch
 * milliseconds to ISO 8601 strings. Every route answering with an item goes
 * through here, so the wire shape lives in one place.
 */
export function toApiMediaItem(item: MediaItem) {
  return {
    id: item.id,
    mediaRootId: item.mediaRootId,
    path: item.path,
    title: item.title,
    durationMs: item.durationMs,
    hasAudio: item.hasAudio,
    hasVideo: item.hasVideo,
    status: item.status,
    probeError: item.probeError,
    createdAt: toApiTimestamp(item.createdAt),
    updatedAt: toApiTimestamp(item.updatedAt),
    lastSeenAt: toApiTimestamp(item.lastSeenAt),
    lastProbedAt: toApiTimestampOrNull(item.lastProbedAt),
    metadata: {
      ...item.metadata,
      refreshedAt: toApiTimestampOrNull(item.metadata.refreshedAt),
    },
  };
}
