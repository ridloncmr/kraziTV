import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { WriteAuthorityBusyError } from "../database/writes/immediate-transaction.js";
import { toApiTimestamp } from "./api-timestamp.js";

type ApiErrorCode =
  | "already_set_up"
  | "channel_disabled"
  | "channel_not_found"
  | "channel_number_duplicate"
  | "channel_runtime_cleanup_failed"
  | "channels_left_unschedulable"
  | "channel_unschedulable"
  | "folder_not_found"
  | "folder_unreadable"
  | "invalid_password"
  | "invalid_request"
  | "internal_error"
  | "media_collection_in_use"
  | "media_collection_not_found"
  | "media_item_in_use"
  | "media_item_not_found"
  | "media_root_disabled"
  | "media_root_duplicate"
  | "media_root_not_found"
  | "media_root_path_immutable"
  | "media_root_removal_pending"
  | "media_root_unavailable"
  | "no_current_playout"
  | "not_found"
  | "playout_unavailable"
  | "programming_block_limit_reached"
  | "programming_block_not_found"
  | "scan_cancelled"
  | "scan_in_progress"
  | "scan_not_found"
  | "schedule_busy"
  | "setup_required"
  | "stream_failed"
  | "stream_startup_timeout"
  | "stream_unavailable"
  | "too_many_attempts"
  | "unauthenticated";

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

/** One 409 shape for every route a disabled channel cannot serve, in any domain. */
export function sendChannelDisabled(
  reply: FastifyReply,
  id: string,
): FastifyReply {
  return sendApiError(
    reply,
    409,
    "channel_disabled",
    `Channel ${id} is disabled`,
  );
}

/**
 * One retryable 503 for every schedule read or write that could not get or
 * keep write authority, whether the writer stayed busy or won a race.
 */
export function sendScheduleBusy(reply: FastifyReply): FastifyReply {
  return sendApiError(
    reply,
    503,
    "schedule_busy",
    "The schedule is busy; retry the request",
    { retryable: true },
  );
}

/**
 * One 400 shape for every schedule or playout request whose coverage instant
 * lies past the request limit. `param` names the query or body field that
 * set the instant, so the client knows which value to change.
 */
export function sendThroughOutOfRange(
  reply: FastifyReply,
  param: string,
  latestThrough: number,
): FastifyReply {
  return sendApiError(
    reply,
    400,
    "invalid_request",
    `${param} must not be after ${toApiTimestamp(latestThrough)}`,
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
      return sendScheduleBusy(reply);
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
