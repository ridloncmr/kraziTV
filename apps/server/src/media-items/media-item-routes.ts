import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  sendInvalidRequest,
  sendMediaItemNotFound,
} from "../http/api-error.js";
import { idParams } from "../http/request-schemas.js";
import { toApiMediaItem } from "./api-media-item.js";
import type { MediaItemRepository } from "./media-item-repository.js";

// Bounds one response so a large catalog never ships in a single read.
const MAX_PAGE_SIZE = 200;

// A key given once arrives as a string and a repeated key as an array, so
// each filter field takes either and always yields a list.
function repeated<T extends z.ZodType>(value: T) {
  return z
    .union([value, z.array(value)])
    .transform((given) => (Array.isArray(given) ? given : [given]))
    .optional();
}

const tmdbId = z.coerce.number().int().positive();

// Query strings arrive as text, so numbers are coerced before range checks.
// Each filter key repeats once per value it keeps.
const listQuery = z.strictObject({
  q: z.string().trim().default(""),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  matchState: repeated(
    z.enum([
      "not_looked_up",
      "unmatched",
      "lookup_failed",
      "ambiguous",
      "matched",
      "rejected",
      "file_changed",
      "episode_unlisted",
    ]),
  ),
  contentType: repeated(z.enum(["movie", "episode", "extra", "unidentified"])),
  detail: repeated(z.enum(["corrected", "tmdb_expired", "refresh_failed"])),
  collection: repeated(z.enum(["none"])),
  status: repeated(z.enum(["available", "missing", "probe_failed"])),
  mediaRootId: repeated(z.string()),
  seriesTmdbId: repeated(tmdbId),
  franchiseTmdbId: repeated(tmdbId),
  genre: repeated(z.string()),
  tagId: repeated(z.string()),
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
    const { q, limit, offset } = query.data;
    const page = await mediaItems.list({
      search: q,
      limit,
      offset,
      filter: {
        matchStates: query.data.matchState,
        contentTypes: query.data.contentType,
        details: query.data.detail,
        collections: query.data.collection,
        statuses: query.data.status,
        mediaRootIds: query.data.mediaRootId,
        seriesTmdbIds: query.data.seriesTmdbId,
        franchiseTmdbIds: query.data.franchiseTmdbId,
        genres: query.data.genre,
        tagIds: query.data.tagId,
      },
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
    return item === undefined
      ? sendMediaItemNotFound(reply, id)
      : toApiMediaItem(item);
  });
}
