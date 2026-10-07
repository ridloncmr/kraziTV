import type { FastifyInstance, FastifyReply } from "fastify";
import { isSchedulableMedia } from "@krazitv/krazi-brain";
import { z } from "zod";

import {
  sendApiError,
  sendInvalidRequest,
  sendUnknownMediaItems,
} from "../http/api-error.js";
import { toApiTimestamp } from "../http/api-timestamp.js";
import { idParams, nameField } from "../http/request-schemas.js";
import type { ScheduleService } from "../schedules/schedule-service.js";
import type { MediaCollection, MediaCollectionMember } from "./contracts.js";
import type { MediaCollectionRepository } from "./media-collection-repository.js";
import { membershipChange } from "./replace-collection-members.js";

// Duplicates are a caller error the repository never sees.
const mediaItemIds = z
  .array(z.string())
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "mediaItemIds must not contain duplicates",
  });

const createBody = z.strictObject({
  name: nameField,
  mediaItemIds: mediaItemIds.optional(),
});

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
    return collections.map(toApiMediaCollection);
  });

  server.post("/media-collections", async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
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
    createdAt: toApiTimestamp(collection.createdAt),
    updatedAt: toApiTimestamp(collection.updatedAt),
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
