import type { FastifyInstance, FastifyReply } from "fastify";
import { isSchedulableMedia } from "@krazitv/krazi-brain";
import { z } from "zod";

import {
  sendApiError,
  sendInvalidRequest,
  sendUnknownMediaItems,
} from "../../http/api-error.js";
import {
  toApiTimestamp,
  toApiTimestampOrNull,
} from "../../http/api-timestamp.js";
import {
  idParams,
  nameField,
  uniqueMediaItemIds as mediaItemIds,
} from "../../http/request-schemas.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import type {
  MediaCollection,
  MediaCollectionMember,
  MediaCollectionSummary,
} from "../contracts.js";
import { collectionCriterionSchema } from "../criteria/collection-criterion.js";
import type { MediaCollectionRepository } from "../persistence/media-collection-repository.js";
import { membershipChange } from "../persistence/replace-collection-members.js";

// A collection starts from explicit members or from a criterion, never both.
const createBody = z
  .strictObject({
    name: nameField,
    mediaItemIds: mediaItemIds.optional(),
    criterion: collectionCriterionSchema.optional(),
  })
  .refine(
    (body) => body.mediaItemIds === undefined || body.criterion === undefined,
    { message: "Give mediaItemIds or a criterion, not both" },
  );

const previewBody = z.strictObject({ criterion: collectionCriterionSchema });

const renameBody = z.strictObject({ name: nameField });

const replaceMembersBody = z.strictObject({ mediaItemIds });

/** Registers media-collection HTTP routes; validation and status mapping live only here. */
export function registerMediaCollectionRoutes(
  server: FastifyInstance,
  mediaCollections: MediaCollectionRepository,
  schedules: ScheduleService,
): void {
  server.get("/media-collections", async () => {
    const collections = await mediaCollections.list();
    return collections.map(toApiMediaCollectionSummary);
  });

  server.post("/media-collections", async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    if (body.data.criterion !== undefined) {
      const collection = await mediaCollections.createAutomatic(
        body.data.name,
        body.data.criterion,
      );
      return reply.status(201).send(toApiMediaCollection(collection));
    }
    const result = await mediaCollections.create(
      body.data.name,
      body.data.mediaItemIds,
    );
    if (result.kind === "unknown_media_items") {
      return sendUnknownMediaItems(reply, result.mediaItemIds);
    }

    return reply.status(201).send(toApiMediaCollection(result.collection));
  });

  server.get("/media-collections/series", async () =>
    mediaCollections.listCatalogSeries(),
  );

  // The browser shows this answer as the preview; it never matches itself.
  server.post("/media-collections/previews", async (request, reply) => {
    const body = previewBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const members = await mediaCollections.previewCriterion(
      body.data.criterion,
    );
    return members.map(toApiMediaCollectionMember);
  });

  server.get("/media-collections/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const collection = await mediaCollections.findById(id);
    if (collection === undefined) {
      return sendCollectionNotFound(reply, id);
    }
    return toApiMediaCollection(collection);
  });

  server.patch("/media-collections/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = renameBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const collection = await mediaCollections.rename(id, body.data.name);
    if (collection === undefined) {
      return sendCollectionNotFound(reply, id);
    }
    return toApiMediaCollection(collection);
  });

  server.delete("/media-collections/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await mediaCollections.delete(id);
    if (result.kind === "not_found") {
      return sendCollectionNotFound(reply, id);
    }
    if (result.kind === "in_use") {
      return sendApiError(
        reply,
        409,
        "media_collection_in_use",
        `Media collection ${id} is used by programming blocks on channels: ${result.channelIds.join(", ")}`,
        { channelIds: result.channelIds },
      );
    }
    return reply.status(204).send();
  });

  server.get("/media-collections/:id/items", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const members = await mediaCollections.listMembers(id);
    if (members === undefined) {
      return sendCollectionNotFound(reply, id);
    }
    return members.map(toApiMediaCollectionMember);
  });

  // The browser displays eligibility; kraziBrain alone owns its duration/status policy.
  server.get("/media-collections/:id/status", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const members = await mediaCollections.listMembers(id);
    if (members === undefined) return sendCollectionNotFound(reply, id);
    const schedulableCount = members.filter((member) =>
      isSchedulableMedia({ ...member, id: member.mediaItemId }),
    ).length;
    return {
      schedulable: schedulableCount > 0,
      memberCount: members.length,
      schedulableCount,
    };
  });

  server.put("/media-collections/:id/items", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = replaceMembersBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const result = await schedules.applyInputChange(
      request.log,
      "membership_changed",
      membershipChange(id, body.data.mediaItemIds),
    );
    if (result.kind === "not_found") {
      return sendCollectionNotFound(reply, id);
    }
    if (result.kind === "automatic") {
      return sendApiError(
        reply,
        409,
        "media_collection_automatic",
        `Media collection ${id} keeps its own members; convert it to manual to edit them`,
      );
    }
    if (result.kind === "unknown_media_items") {
      return sendUnknownMediaItems(reply, result.mediaItemIds);
    }
    return result.members.map(toApiMediaCollectionMember);
  });
}

// One 404 shape for every collection route.
function sendCollectionNotFound(reply: FastifyReply, id: string) {
  return sendApiError(
    reply,
    404,
    "media_collection_not_found",
    `Media collection ${id} does not exist`,
  );
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
function toApiMediaCollection(collection: MediaCollection) {
  return {
    id: collection.id,
    name: collection.name,
    maintenanceMode: collection.maintenanceMode,
    criterion: collection.criterion,
    criterionLabel: collection.criterionLabel,
    maintainedAt: toApiTimestampOrNull(collection.maintainedAt),
    maintenanceError: collection.maintenanceError,
    createdAt: toApiTimestamp(collection.createdAt),
    updatedAt: toApiTimestamp(collection.updatedAt),
  };
}

// Adds the listing-only member counts to the shared collection shape.
function toApiMediaCollectionSummary(collection: MediaCollectionSummary) {
  return {
    ...toApiMediaCollection(collection),
    memberCount: collection.memberCount,
    missingCount: collection.missingCount,
  };
}

// Uses the media item API's field names so clients read one vocabulary.
function toApiMediaCollectionMember(member: MediaCollectionMember) {
  return {
    position: member.position,
    mediaItemId: member.mediaItemId,
    title: member.title,
    path: member.path,
    status: member.status,
    durationMs: member.durationMs,
  };
}
