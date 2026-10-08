import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendApiError, sendInvalidRequest } from "../../http/api-error.js";
import { nameField } from "../../http/request-schemas.js";
import type { AuthService } from "../auth-service.js";
import {
  readSessionCookie,
  sessionCookie,
} from "../sessions/session-cookie.js";

const setupBody = z.strictObject({
  displayName: nameField.max(40, "displayName must be at most 40 characters"),
  // Never trimmed: every character the owner typed is part of the password.
  password: z
    .string()
    .min(8, "password must be at least 8 characters")
    .max(256, "password must be at most 256 characters"),
});

/** Cookie settings fixed at startup from parsed configuration. */
interface AuthRouteSettings {
  /** True when the public base URL is https, so the cookie is sent only over TLS. */
  secureCookie: boolean;
}

/**
 * Registers the auth routes a logged-out browser needs. Cookies are read and
 * written only here; the service sees bare tokens.
 */
export function registerAuthRoutes(
  server: FastifyInstance,
  auth: AuthService,
  settings: AuthRouteSettings,
): void {
  server.get("/auth/state", async (request) =>
    auth.state(readSessionCookie(request.headers.cookie)),
  );

  server.post("/auth/setup", async (request, reply) => {
    const body = setupBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const result = await auth.setUp(body.data);
    if (result.kind === "already_set_up") {
      return sendApiError(
        reply,
        409,
        "already_set_up",
        "The account is already set up",
      );
    }

    const { token, maxAgeSeconds } = result.session;
    return reply
      .status(201)
      .header(
        "set-cookie",
        sessionCookie(token, maxAgeSeconds, settings.secureCookie),
      )
      .send(await auth.state(token));
  });
}
