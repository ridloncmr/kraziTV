import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendInvalidRequest } from "../../http/api-error.js";
import { countField, idParams, nameField } from "../../http/request-schemas.js";
import { sendMetadataRefusal } from "../metadata-refusal-reply.js";
import type { TrackMappingService } from "./track-mapping-service.js";

const seriesId = z.number().int().positive();

const searchQuery = z.object({ query: nameField });

// Query values arrive as text, so the proposal's numbers are coerced first.
const proposalQuery = z.object({
  tmdbSeriesId: z.coerce.number().pipe(seriesId),
  season: z.coerce.number().pipe(countField),
});

// Each track appears once; a null episode skips the track.
const mappingBody = z.strictObject({
  tmdbSeriesId: seriesId,
  season: countField,
  rows: z
    .array(
      z.strictObject({
        mediaItemId: z.string(),
        episodeNumber: countField.nullable(),
      }),
    )
    .min(1)
    .refine(
      (rows) =>
        new Set(rows.map((row) => row.mediaItemId)).size === rows.length,
      { message: "name each track once" },
    ),
});

/**
 * Registers the disc-track mapping routes under `/metadata`. They sit behind
 * the auth gate, and each refuses without a TMDB key; status mapping lives
 * in `sendMetadataRefusal`.
 */
export function registerTrackMappingRoutes(
  server: FastifyInstance,
  mappings: TrackMappingService,
): void {
  server.get("/metadata/track-mappings/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const folder = await mappings.folder(id);
    if ("kind" in folder) {
      return sendMetadataRefusal(request, reply, id, folder);
    }
    return {
      series: folder.series,
      season: folder.season,
      tracks: folder.tracks.map(
        ({ mediaItemId, path, disc, track, durationMs }) => ({
          mediaItemId,
          path,
          disc,
          track,
          durationMs,
        }),
      ),
    };
  });

  server.get("/metadata/series-search", async (request, reply) => {
    const query = searchQuery.safeParse(request.query);
    if (!query.success) {
      return sendInvalidRequest(reply, query.error);
    }
    const result = await mappings.searchSeries(query.data.query);
    return "kind" in result
      ? sendMetadataRefusal(request, reply, "", result)
      : result;
  });

  server.get(
    "/metadata/track-mappings/:id/proposal",
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const query = proposalQuery.safeParse(request.query);
      if (!query.success) {
        return sendInvalidRequest(reply, query.error);
      }
      const { tmdbSeriesId, season } = query.data;
      const result = await mappings.propose(id, tmdbSeriesId, season);
      return "kind" in result
        ? sendMetadataRefusal(request, reply, id, result)
        : result;
    },
  );

  server.post("/metadata/track-mappings/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = mappingBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const result = await mappings.apply(id, body.data);
    return "kind" in result
      ? sendMetadataRefusal(request, reply, id, result)
      : result;
  });
}
