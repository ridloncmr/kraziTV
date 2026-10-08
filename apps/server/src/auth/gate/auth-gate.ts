import type { FastifyInstance } from "fastify";

import { sendApiError } from "../../http/api-error.js";
import type { RequestAuthenticator } from "../contracts.js";
import { readSessionCookie } from "../sessions/session-cookie.js";
import { isPublicRoute } from "./public-routes.js";

/**
 * Denies every request without a valid session unless its matched route is
 * public (ADR 0012). Call it after CORS registers and before any route: hooks
 * run in registration order, so CORS answers preflights and labels a 401 for
 * the web origin first, and no handler runs before the gate decides.
 *
 * Unmatched requests are gated too, so a logged-out client cannot probe which
 * admin routes exist; with a session they reach the 404 handler.
 */
export function registerAuthGate(
  server: FastifyInstance,
  authenticator: RequestAuthenticator,
): void {
  server.addHook("onRequest", async (request, reply) => {
    if (isPublicRoute(request.method, request.routeOptions.url)) return;

    const authentication = await authenticator.authenticate(
      readSessionCookie(request.headers.cookie),
    );
    switch (authentication.kind) {
      case "authenticated":
        return;
      case "setup_required":
        return sendApiError(
          reply,
          401,
          "setup_required",
          "Set up the kraziTV account first",
        );
      case "unauthenticated":
        return sendApiError(reply, 401, "unauthenticated", "Log in first");
    }
  });
}
