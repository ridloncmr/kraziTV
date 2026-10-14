import type { FastifyInstance } from "fastify";
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
import { criterionChange } from "../maintenance/criterion-change.js";
import {
  sendCollectionNotFound,
  sendManualRefusal,
} from "./collection-replies.js";

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

// Naming a collection applies its exclusions, as changing its criterion would.
const previewBody = z.strictObject({
  criterion: collectionCriterionSchema,
  mediaCollectionId: z.string().optional(),
});

// A rename, a criterion change, or both; renaming never changes the criterion.
const patchBody = z
  .strictObject({
    name: nameField.optional(),
    criterion: collectionCriterionSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.criterion !== undefined, {
    message: "Give a name, a criterion, or both",
  });

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
    mediaCollections.listCatalogGroups("series"),
  );

  server.get("/media-collections/franchises", async () =>
    mediaCollections.listCatalogGroups("franchise"),
  );

  server.get("/media-collections/tags", async () =>
    mediaCollections.listCatalogTags(),
  );

  // The browser shows this answer as the preview; it never matches itself.
  server.post("/media-collections/previews", async (request, reply) => {
    const body = previewBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const { criterion, mediaCollectionId } = body.data;
    const members = await mediaCollections.previewCriterion(
      criterion,
      mediaCollectionId,
    );
    if (members === undefined) {
      return sendCollectionNotFound(reply, mediaCollectionId ?? "");
    }
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
    const body = patchBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const { name, criterion } = body.data;

    if (criterion !== undefined) {
      const result = await schedules.applyInputChange(
        request.log,
        "membership_changed",
        criterionChange(id, criterion, name),
      );
      if (result.kind === "manual") {
        return sendManualRefusal(reply, id);
      }
    }
    const collection =
      criterion === undefined && name !== undefined
        ? await mediaCollections.rename(id, name)
        : await mediaCollections.findById(id);
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

  server.post("/media-collections/:id/conversion", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const collection = await mediaCollections.convertToManual(id);
    if (collection === undefined) {
      return sendCollectionNotFound(reply, id);
    }
    return toApiMediaCollection(collection);
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
    maintenanceIncomplete: collection.maintenanceIncomplete,
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
