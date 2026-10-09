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
  // Present only to filter, so any value but `true` is a caller error.
  needsChoice: z.literal("true").optional(),
});

// Bulk selection takes every match at once; the cap keeps one response bounded
// and `total` tells the caller when the search must be narrowed first.
const MAX_MATCHES = 5000;

// Searches that exclude IDs travel in a body, because a large collection's
// member IDs would overflow a query string.
const excludeIds = z.array(z.string()).default([]);

const searchBody = z.strictObject({
  q: z.string().trim().default(""),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.number().int().min(0).default(0),
  excludeIds,
});

const matchesBody = z.strictObject({
  q: z.string().trim().default(""),
  excludeIds,
});

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
    const { q, limit, offset, needsChoice } = query.data;
    const page = await mediaItems.list({
      search: q,
      limit,
      offset,
      needsChoice: needsChoice !== undefined,
    });
    return { items: page.items.map(toApiMediaItem), total: page.total };
  });

  server.post("/media-items/search", async (request, reply) => {
    const body = searchBody.safeParse(request.body ?? {});
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const { q, limit, offset } = body.data;
    const page = await mediaItems.list({
      search: q,
      limit,
      offset,
      excludeIds: body.data.excludeIds,
    });
    return { items: page.items.map(toApiMediaItem), total: page.total };
  });

  server.post("/media-items/matches", async (request, reply) => {
    const body = matchesBody.safeParse(request.body ?? {});
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const page = await mediaItems.list({
      search: body.data.q,
      limit: MAX_MATCHES,
      offset: 0,
      excludeIds: body.data.excludeIds,
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
    metadata: {
      ...item.metadata,
      refreshedAt: toApiTimestampOrNull(item.metadata.refreshedAt),
    },
  };
}
