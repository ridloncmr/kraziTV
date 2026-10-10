import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  sendInvalidRequest,
  sendMediaItemNotFound,
} from "../../http/api-error.js";
import { idParams } from "../../http/request-schemas.js";
import { toApiMediaItem } from "../../media-items/api-media-item.js";
import type { MediaItemRepository } from "../../media-items/media-item-repository.js";
import { sendMetadataRefusal } from "../metadata-refusal-reply.js";
import type { MatchChoiceService } from "./match-choice-service.js";

const choiceBody = z.strictObject({
  tmdbId: z.number().int().positive(),
});

// Path parameters arrive as text, so the candidate's TMDB ID is coerced.
const runtimeParams = z.object({
  id: z.string(),
  tmdbId: z.coerce.number().int().positive(),
});

/**
 * Registers the owner's match decision routes under `/metadata`. They sit
 * behind the auth gate; status mapping lives only here.
 */
export function registerMatchChoiceRoutes(
  server: FastifyInstance,
  choices: MatchChoiceService,
  mediaItems: MediaItemRepository,
): void {
  server.get("/metadata/match-reviews", async () => ({
    steps: await choices.reviewSteps(),
  }));

  server.get("/metadata/matches/:id/candidates", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await choices.candidates(id);
    return "candidates" in result
      ? result
      : sendMetadataRefusal(request, reply, id, result);
  });

  server.get(
    "/metadata/matches/:id/candidates/:tmdbId/runtime",
    async (request, reply) => {
      const params = runtimeParams.safeParse(request.params);
      if (!params.success) {
        return sendInvalidRequest(reply, params.error);
      }
      const { id, tmdbId } = params.data;
      const result = await choices.runtime(id, tmdbId);
      return result.kind === "runtime"
        ? { runtimeMs: result.runtimeMs }
        : sendMetadataRefusal(request, reply, id, result);
    },
  );

  server.post("/metadata/matches/:id/choice", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = choiceBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const result = await choices.choose(id, body.data.tmdbId);
    return result.kind === "chosen"
      ? { resolvedCount: result.resolvedCount }
      : sendMetadataRefusal(request, reply, id, result);
  });

  server.post("/metadata/matches/:id/rejection", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await choices.reject(id);
    return result.kind === "rejected"
      ? { matchState: "rejected" }
      : sendMetadataRefusal(request, reply, id, result);
  });

  server.delete("/metadata/matches/:id/rejection", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await choices.clearRejection(id);
    return result.kind === "cleared"
      ? { matchState: "not_looked_up" }
      : sendMetadataRefusal(request, reply, id, result);
  });

  // Answers with the item as now shown, so the details view drops the
  // changed-file flag without a second read.
  server.post("/metadata/matches/:id/keep", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await choices.keepMatch(id);
    if (result.kind !== "kept") {
      return sendMetadataRefusal(request, reply, id, result);
    }
    // A removal committed since keeping the match makes the item gone.
    const item = await mediaItems.findById(id);
    return item === undefined
      ? sendMediaItemNotFound(reply, id)
      : toApiMediaItem(item);
  });
}
