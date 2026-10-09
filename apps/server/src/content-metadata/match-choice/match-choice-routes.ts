import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  sendApiError,
  sendInvalidRequest,
  sendMediaItemNotFound,
} from "../../http/api-error.js";
import { idParams } from "../../http/request-schemas.js";
import { toApiMediaItem } from "../../media-items/api-media-item.js";
import type { MediaItemRepository } from "../../media-items/media-item-repository.js";
import type { MatchChoiceRefusal } from "../contracts.js";
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
      : sendRefusal(request, reply, id, result);
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
        : sendRefusal(request, reply, id, result);
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
      : sendRefusal(request, reply, id, result);
  });

  server.post("/metadata/matches/:id/rejection", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await choices.reject(id);
    return result.kind === "rejected"
      ? { matchState: "rejected" }
      : sendRefusal(request, reply, id, result);
  });

  server.delete("/metadata/matches/:id/rejection", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await choices.clearRejection(id);
    return result.kind === "cleared"
      ? { matchState: "not_looked_up" }
      : sendRefusal(request, reply, id, result);
  });

  // Answers with the item as now shown, so the details view drops the
  // changed-file flag without a second read.
  server.post("/metadata/matches/:id/keep", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await choices.keepMatch(id);
    if (result.kind !== "kept") {
      return sendRefusal(request, reply, id, result);
    }
    // A removal committed since keeping the match makes the item gone.
    const item = await mediaItems.findById(id);
    return item === undefined
      ? sendMediaItemNotFound(reply, id)
      : toApiMediaItem(item);
  });
}

/**
 * Maps why a decision changed nothing to its answer. A TMDB failure's reason
 * is logged, not sent: it names the outage, which the owner cannot act on.
 */
function sendRefusal(
  request: FastifyRequest,
  reply: FastifyReply,
  id: string,
  refusal: MatchChoiceRefusal,
): FastifyReply {
  switch (refusal.kind) {
    case "item_not_found":
      return sendMediaItemNotFound(reply, id);
    case "not_ambiguous":
      return sendApiError(
        reply,
        409,
        "match_not_ambiguous",
        "This item's match has changed. Reopen it to see where it stands.",
      );
    case "candidate_not_offered":
      return sendApiError(
        reply,
        400,
        "candidate_not_offered",
        "Choose one of the candidates this item offers.",
      );
    case "tmdb_key_missing":
      return sendApiError(
        reply,
        409,
        "tmdb_key_required",
        "Set up TMDB in Account Settings first.",
      );
    case "lookup_failed":
      request.log.warn(
        { reason: refusal.reason },
        "Could not read a chosen match from TMDB",
      );
      return sendApiError(
        reply,
        502,
        "tmdb_unreachable",
        "kraziTV could not read this match from TMDB. Try again later.",
      );
    case "episode_not_in_series":
      return sendApiError(
        reply,
        409,
        "episode_not_in_series",
        "TMDB lists no such episode in that series. Choose another or reject the match.",
      );
    case "not_rejectable":
      return sendApiError(
        reply,
        409,
        "match_not_rejectable",
        "Only a matched item or one that needs a choice can be rejected.",
      );
    case "not_rejected":
      return sendApiError(
        reply,
        409,
        "match_not_rejected",
        "This item's match is not rejected.",
      );
    case "not_matched":
      return sendApiError(
        reply,
        409,
        "match_not_matched",
        "This item's match has changed. Reopen it to see where it stands.",
      );
  }
}
