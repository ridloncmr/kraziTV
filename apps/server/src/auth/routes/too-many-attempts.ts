import type { FastifyReply } from "fastify";

import { sendApiError } from "../../http/api-error.js";

/**
 * Answers a password check the attempt throttle refused. Login and the
 * password change share this one envelope, so the web app reads one wait
 * shape: the header serves generic HTTP clients, the body field the web app.
 */
export function sendTooManyAttempts(
  reply: FastifyReply,
  retryAfterSeconds: number,
): FastifyReply {
  return sendApiError(
    reply.header("retry-after", String(retryAfterSeconds)),
    429,
    "too_many_attempts",
    "Too many wrong passwords; wait before trying again",
    { retryAfterSeconds },
  );
}
