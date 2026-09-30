import type { FastifyInstance, FastifyReply } from "fastify";

export type ApiErrorCode =
  | "invalid_request"
  | "internal_error"
  | "media_item_not_found"
  | "media_root_disabled"
  | "media_root_duplicate"
  | "media_root_not_found"
  | "media_root_path_immutable"
  | "media_root_unavailable"
  | "not_found"
  | "scan_cancelled"
  | "scan_in_progress";

/** Sends the one error envelope every API client can rely on. */
export function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
): FastifyReply {
  return reply.status(statusCode).send({ error: { code, message } });
}

/**
 * Maps framework-level failures, such as malformed JSON or unknown routes, into
 * the same envelope so clients never parse Fastify's default error format.
 */
export function registerApiErrorHandlers(server: FastifyInstance): void {
  server.setErrorHandler((error, request, reply) => {
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
