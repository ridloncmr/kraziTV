import type { FastifyReply } from "fastify";

import { sendApiError } from "../../http/api-error.js";

/** One 404 shape for every collection route. */
export function sendCollectionNotFound(reply: FastifyReply, id: string) {
  return sendApiError(
    reply,
    404,
    "media_collection_not_found",
    `Media collection ${id} does not exist`,
  );
}
