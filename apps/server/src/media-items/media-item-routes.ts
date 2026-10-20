import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  sendInvalidRequest,
  sendMediaItemNotFound,
} from "../http/api-error.js";
import { idParams } from "../http/request-schemas.js";
import { toApiMediaItem } from "./api-media-item.js";
import type { CatalogFilter } from "./contracts.js";
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

// The catalog filter's keys, each keeping any of its values. A query string
// repeats a key once per value and a body sends a list; `repeated` and the
// coerced IDs accept both, so one shape serves every route.
const catalogFilter = z.strictObject({
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

// Query strings arrive as text, so numbers are coerced before range checks.
const listQuery = z.strictObject({
  ...catalogFilter.shape,
  q: z.string().trim().default(""),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Names a parsed filter's keys as the repository's `CatalogFilter` does. */
function toCatalogFilter(
  fields: z.output<typeof catalogFilter>,
): CatalogFilter {
  return {
    matchStates: fields.matchState,
    contentTypes: fields.contentType,
    details: fields.detail,
    collections: fields.collection,
    statuses: fields.status,
    mediaRootIds: fields.mediaRootId,
    seriesTmdbIds: fields.seriesTmdbId,
    franchiseTmdbIds: fields.franchiseTmdbId,
    genres: fields.genre,
    tagIds: fields.tagId,
  };
}

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
  filter: catalogFilter.default({}),
});

const matchesBody = z.strictObject({
  q: z.string().trim().default(""),
  excludeIds,
  filter: catalogFilter.default({}),
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
      filter: toCatalogFilter(query.data),
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
      filter: toCatalogFilter(body.data.filter),
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
      filter: toCatalogFilter(body.data.filter),
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
