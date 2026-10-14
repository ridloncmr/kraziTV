import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendUnknownMediaItems } from "../../http/api-error.js";
import { idParams } from "../../http/request-schemas.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import { exclusionChange } from "../exclusions/exclusion-change.js";
import type { MediaCollectionRepository } from "../persistence/media-collection-repository.js";
import {
  sendCollectionNotFound,
  sendManualRefusal,
} from "./collection-replies.js";

const exclusionParams = idParams.extend({ mediaItemId: z.string() });

/**
 * Registers an automatic collection's exclusion routes: list, exclude, and
 * restore. Excluding and restoring are schedule input changes, because they
 * change membership channels draw from.
 */
export function registerCollectionExclusionRoutes(
  server: FastifyInstance,
  mediaCollections: MediaCollectionRepository,
  schedules: ScheduleService,
): void {
  server.get("/media-collections/:id/exclusions", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const excluded = await mediaCollections.listExclusions(id);
    if (excluded === undefined) return sendCollectionNotFound(reply, id);
    return excluded;
  });

  for (const [method, excluded] of [
    ["PUT", true],
    ["DELETE", false],
  ] as const) {
    server.route({
      method,
      url: "/media-collections/:id/exclusions/:mediaItemId",
      handler: async (request, reply) => {
        const { id, mediaItemId } = exclusionParams.parse(request.params);
        const result = await schedules.applyInputChange(
          request.log,
          "membership_changed",
          exclusionChange(id, mediaItemId, excluded),
        );
        if (result.kind === "not_found") {
          return sendCollectionNotFound(reply, id);
        }
        if (result.kind === "manual") {
          return sendManualRefusal(reply, id);
        }
        if (result.kind === "unknown_media_items") {
          return sendUnknownMediaItems(reply, result.mediaItemIds);
        }
        return reply.status(204).send();
      },
    });
  }
}
