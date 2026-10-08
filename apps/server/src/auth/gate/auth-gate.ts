import type { FastifyInstance } from "fastify";

import { sendApiError } from "../../http/api-error.js";
import type { RequestAuthenticator } from "../contracts.js";
import {
  readSessionCookie,
  sessionCookie,
} from "../sessions/session-cookie.js";
import { isPublicRoute } from "./public-routes.js";
import { isForeignOrigin } from "./request-origin.js";

/** Settings fixed at startup from parsed configuration. */
interface AuthGateSettings {
  /** Normalized origins a browser write may come from: the public base URL's and the CORS list. */
  allowedOrigins: ReadonlySet<string>;
  /** Whether a reissued session cookie is `Secure`; the auth routes use the same value. */
  secureCookie: boolean;
}

/**
 * Guards every request (ADR 0012). Call it after CORS registers and before
 * any route: hooks run in registration order, so CORS answers preflights and
 * labels a refusal for the web origin first, and no body is parsed and no
 * handler runs before the gate decides.
 *
 * 1. A cross-site write is refused on every route, public ones included, so a
 *    foreign site cannot set up, log the browser in, or log it out.
 * 2. A public route needs nothing more.
 * 3. Anything else, including an unmatched route, needs a valid session, so a
 *    logged-out client cannot probe which admin routes exist.
 * 4. A session due for renewal gets its cookie reissued with the new lifetime.
 */
export function registerAuthGate(
  server: FastifyInstance,
  authenticator: RequestAuthenticator,
  settings: AuthGateSettings,
): void {
  server.addHook("onRequest", async (request, reply) => {
    if (
      isForeignOrigin(
        request.method,
        request.headers.origin,
        settings.allowedOrigins,
      )
    ) {
      return sendApiError(
        reply,
        403,
        "forbidden_origin",
        "Requests that change kraziTV must come from its own web app",
      );
    }
    if (isPublicRoute(request.method, request.routeOptions.url)) return;

    const token = readSessionCookie(request.headers.cookie);
    const authentication = await authenticator.authenticate(token, request.log);
    switch (authentication.kind) {
      case "authenticated":
        // A renewal implies the request carried the token it renewed.
        if (authentication.renewal !== undefined && token !== undefined) {
          reply.header(
            "set-cookie",
            sessionCookie(
              token,
              authentication.renewal.maxAgeSeconds,
              settings.secureCookie,
            ),
          );
        }
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
