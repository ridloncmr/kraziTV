import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendApiError, sendInvalidRequest } from "../../http/api-error.js";
import type { Recommendation } from "../contracts.js";
import { collectionCriterionSchema } from "../criteria/collection-criterion.js";
import type { MediaCollectionRepository } from "../persistence/media-collection-repository.js";
import { toApiMediaCollection } from "./collection-replies.js";

// Only series and franchises are recommended; genres and tags are created on request.
const recommendedCriterion = collectionCriterionSchema.refine(
  (criterion): criterion is Recommendation["criterion"] =>
    criterion.kind === "series" || criterion.kind === "franchise",
  { message: "Only series and franchise criteria are recommended" },
);

const listQuery = z.object({ dismissed: z.literal("true").optional() });

const acceptanceBody = z.strictObject({
  criterion: recommendedCriterion,
  mode: z.enum(["automatic", "manual"]),
});

const decisionBody = z.strictObject({ criterion: recommendedCriterion });

/**
 * Registers collection recommendation routes: list, accept, dismiss, and
 * restore. Recommendations are computed on request; listing one never
 * creates a collection.
 */
export function registerRecommendationRoutes(
  server: FastifyInstance,
  mediaCollections: MediaCollectionRepository,
): void {
  server.get("/media-collections/recommendations", async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) return sendInvalidRequest(reply, query.error);
    const recommendations = await mediaCollections.listRecommendations(
      query.data.dismissed === "true",
    );
    return recommendations.map(toApiRecommendation);
  });

  server.post(
    "/media-collections/recommendations/acceptance",
    async (request, reply) => {
      const body = acceptanceBody.safeParse(request.body);
      if (!body.success) return sendInvalidRequest(reply, body.error);
      const result = await mediaCollections.acceptRecommendation(body.data);
      if (result.kind === "decided") {
        return sendApiError(
          reply,
          409,
          "recommendation_decided",
          "This recommendation was already accepted, dismissed, or created",
        );
      }
      if (result.kind === "unavailable") {
        return sendApiError(
          reply,
          409,
          "recommendation_unavailable",
          "The catalog no longer supports this recommendation",
        );
      }
      return reply.status(201).send(toApiMediaCollection(result.collection));
    },
  );

  for (const [url, decision] of [
    ["/media-collections/recommendations/dismissal", "dismissed"],
    ["/media-collections/recommendations/restoration", undefined],
  ] as const) {
    server.post(url, async (request, reply) => {
      const body = decisionBody.safeParse(request.body);
      if (!body.success) return sendInvalidRequest(reply, body.error);
      await mediaCollections.decideRecommendation(
        body.data.criterion,
        decision,
      );
      return reply.status(204).send();
    });
  }
}

// Projects a recommendation with its member count beside its members.
function toApiRecommendation(recommendation: Recommendation) {
  return {
    criterion: recommendation.criterion,
    name: recommendation.name,
    reason: recommendation.reason,
    memberCount: recommendation.members.length,
    members: recommendation.members,
    seasonCount: recommendation.seasonCount,
    collectionId: recommendation.collectionId,
    decision: recommendation.decision,
  };
}
