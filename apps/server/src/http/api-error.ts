import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { WriteAuthorityBusyError } from "../database/writes/immediate-transaction.js";

type ApiErrorCode =
  | "channel_disabled"
  | "channel_not_found"
  | "channel_number_duplicate"
  | "channel_runtime_cleanup_failed"
  | "channel_unschedulable"
  | "invalid_request"
  | "internal_error"
  | "media_collection_in_use"
  | "media_collection_not_found"
  | "media_item_not_found"
  | "media_root_disabled"
  | "media_root_duplicate"
  | "media_root_not_found"
  | "media_root_path_immutable"
  | "media_root_unavailable"
  | "not_found"
  | "programming_block_limit_reached"
  | "programming_block_not_found"
  | "scan_cancelled"
  | "scan_in_progress"
  | "schedule_busy";

/**
 * Sends the one error envelope every API client can rely on. Details add
 * code-specific fields beside code and message, never replacing them.
 */
export function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): FastifyReply {
  return reply
    .status(statusCode)
    .send({ error: { ...details, code, message } });
}

/** Every body failure shares one code; the message carries Zod's field detail. */
export function sendInvalidRequest(
  reply: FastifyReply,
  error: z.ZodError,
): FastifyReply {
  return sendApiError(reply, 400, "invalid_request", z.prettifyError(error));
}

/** One 404 shape for every route that addresses a channel, in any domain. */
export function sendChannelNotFound(
  reply: FastifyReply,
  id: string,
): FastifyReply {
  return sendApiError(
    reply,
    404,
    "channel_not_found",
    `Channel ${id} does not exist`,
  );
}

/** One 404 shape for every route that addresses a media root, in any domain. */
export function sendMediaRootNotFound(
  reply: FastifyReply,
  id: string,
): FastifyReply {
  return sendApiError(
    reply,
    404,
    "media_root_not_found",
    `Media root ${id} does not exist`,
  );
}

/**
 * Lists every unknown media item ID a request referenced, so the client can
 * point at exactly what to fix. A 400, not a 404: the addressed resource
 * exists, the body names items that do not.
 */
export function sendUnknownMediaItems(
  reply: FastifyReply,
  ids: readonly string[],
): FastifyReply {
  return sendApiError(
    reply,
    400,
    "media_item_not_found",
    `Unknown media items: ${ids.join(", ")}`,
  );
}

/**
 * Maps framework-level failures, such as malformed JSON or unknown routes, into
 * the same envelope so clients never parse Fastify's default error format.
 * A schedule writer that stayed busy is mapped here once, so every route that
 * writes the schedule answers it as retryable instead of a 500.
 */
export function registerApiErrorHandlers(server: FastifyInstance): void {
  server.setErrorHandler((error, request, reply) => {
    if (error instanceof WriteAuthorityBusyError) {
      return sendApiError(
        reply,
        503,
        "schedule_busy",
        "The schedule is busy; retry the request",
        { retryable: true },
      );
    }

    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;

    if (statusCode >= 400 && statusCode < 500) {
      const message = error instanceof Error ? error.message : "Bad request";
      return sendApiError(reply, statusCode, "invalid_request", message);
    }

    request.log.error(error);
    return sendApiError(reply, 500, "internal_error", "Internal server error");
  });

  // Unknown routes bypass the error handler, so they need their own envelope.
  server.setNotFoundHandler((request, reply) =>
    sendApiError(
      reply,
      404,
      "not_found",
      `Route ${request.method} ${request.url} does not exist`,
    ),
  );
}
