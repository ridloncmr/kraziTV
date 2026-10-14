import type { FastifyReply } from "fastify";

import { sendApiError } from "../../http/api-error.js";
import {
  toApiTimestamp,
  toApiTimestampOrNull,
} from "../../http/api-timestamp.js";
import type { MediaCollection } from "../contracts.js";

/**
 * Projects a collection as every collection route answers with it,
 * converting internal epoch milliseconds to the ISO 8601 strings the API
 * promises.
 */
export function toApiMediaCollection(collection: MediaCollection) {
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

/** Refuses an edit only an automatic collection accepts, such as a criterion or an exclusion. */
export function sendManualRefusal(reply: FastifyReply, id: string) {
  return sendApiError(
    reply,
    409,
    "media_collection_manual",
    `Media collection ${id} is manual; it has no criterion or exclusions`,
  );
}

/** One 404 shape for every collection route. */
export function sendCollectionNotFound(reply: FastifyReply, id: string) {
  return sendApiError(
    reply,
    404,
    "media_collection_not_found",
    `Media collection ${id} does not exist`,
  );
}
