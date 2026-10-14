import type { FastifyReply } from "fastify";

import { sendApiError } from "../../http/api-error.js";

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
