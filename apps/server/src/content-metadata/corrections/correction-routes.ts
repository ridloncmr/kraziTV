import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  sendInvalidRequest,
  sendMediaItemNotFound,
} from "../../http/api-error.js";
import { countField, idParams, nameField } from "../../http/request-schemas.js";
import { toApiMediaItem } from "../../media-items/api-media-item.js";
import type { MediaItemRepository } from "../../media-items/media-item-repository.js";
import type { CorrectionService } from "./correction-service.js";

// Each field is optional, and null clears its correction. Tags are trimmed
// and kept once each, in the owner's order.
const correctionBody = z
  .strictObject({
    title: nameField.nullable().optional(),
    seriesName: nameField.nullable().optional(),
    seasonNumber: countField.nullable().optional(),
    episodeNumber: countField.nullable().optional(),
    tags: z
      .array(nameField)
      .transform((tags) => [...new Set(tags)])
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "name at least one field to change",
  });

/**
 * Registers the owner's correction route under `/metadata`. It sits behind
 * the auth gate and answers with the item as now shown, so the details view
 * updates without a second read.
 */
export function registerCorrectionRoutes(
  server: FastifyInstance,
  corrections: CorrectionService,
  mediaItems: MediaItemRepository,
): void {
  server.patch("/metadata/corrections/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = correctionBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    if ((await corrections.correct(id, body.data)) === "item_not_found") {
      return sendMediaItemNotFound(reply, id);
    }
    // A removal committed since the correction makes the item gone.
    const item = await mediaItems.findById(id);
    return item === undefined
      ? sendMediaItemNotFound(reply, id)
      : toApiMediaItem(item);
  });
}
