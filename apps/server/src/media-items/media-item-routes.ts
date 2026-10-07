import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendApiError, sendInvalidRequest } from "../http/api-error.js";
import { toApiTimestamp, toApiTimestampOrNull } from "../http/api-timestamp.js";
import { idParams } from "../http/request-schemas.js";
import type { MediaItem } from "./contracts.js";
import type { MediaItemRepository } from "./media-item-repository.js";

// Bounds one response so a large catalog never ships in a single read.
const MAX_PAGE_SIZE = 200;

// Query strings arrive as text, so numbers are coerced before range checks.
const listQuery = z.strictObject({
  q: z.string().trim().default(""),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Bulk selection takes every match at once; the cap keeps one response bounded
// and `total` tells the caller when the search must be narrowed first.
const MAX_MATCHES = 5000;

const matchesQuery = z.strictObject({ q: z.string().trim().default("") });

/** Registers read-only catalog routes; status mapping and projection live only here. */
export function registerMediaItemRoutes(
  server: FastifyInstance,
  mediaItems: MediaItemRepository,
): void {
  server.get("/media-items", async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) {
      return sendInvalidRequest(reply, query.error);
    }
    const { q, limit, offset } = query.data;
    const page = await mediaItems.list({ search: q, limit, offset });
    return { items: page.items.map(toApiMediaItem), total: page.total };
  });

  server.get("/media-items/matches", async (request, reply) => {
    const query = matchesQuery.safeParse(request.query);
    if (!query.success) {
      return sendInvalidRequest(reply, query.error);
    }
    const page = await mediaItems.list({
      search: query.data.q,
      limit: MAX_MATCHES,
      offset: 0,
    });
    return { items: page.items.map(toApiMediaItem), total: page.total };
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
    hasVideo: item.hasVideo,
    status: item.status,
    probeError: item.probeError,
    createdAt: toApiTimestamp(item.createdAt),
    updatedAt: toApiTimestamp(item.updatedAt),
    lastSeenAt: toApiTimestamp(item.lastSeenAt),
    lastProbedAt: toApiTimestampOrNull(item.lastProbedAt),
  };
}
