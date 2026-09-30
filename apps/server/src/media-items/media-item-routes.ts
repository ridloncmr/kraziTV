import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendApiError } from "../http/api-error.js";
import type {
  MediaItem,
  MediaItemRepository,
} from "./media-item-repository.js";

const idParams = z.object({ id: z.string() });

/** Registers read-only catalog routes; status mapping and projection live only here. */
export function registerMediaItemRoutes(
  server: FastifyInstance,
  mediaItems: MediaItemRepository,
): void {
  server.get("/media-items", async () => {
    const items = await mediaItems.list();
    return items.map(toApiMediaItem);
  });

  server.get("/media-items/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const item = await mediaItems.findById(id);
    if (item === undefined) {
      return sendApiError(
        reply,
        404,
        "media_item_not_found",
        `Media item ${id} does not exist`,
      );
    }
    return toApiMediaItem(item);
  });
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
function toApiMediaItem(item: MediaItem) {
  return {
    id: item.id,
    mediaRootId: item.mediaRootId,
    path: item.path,
    title: item.title,
    durationMs: item.durationMs,
    hasAudio: item.hasAudio,
    status: item.status,
    probeError: item.probeError,
    createdAt: new Date(item.createdAt).toISOString(),
    updatedAt: new Date(item.updatedAt).toISOString(),
    lastSeenAt: new Date(item.lastSeenAt).toISOString(),
    lastProbedAt:
      item.lastProbedAt === null
        ? null
        : new Date(item.lastProbedAt).toISOString(),
  };
}
