import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendApiError, sendInvalidRequest } from "../../http/api-error.js";
import type { AuthService } from "../auth-service.js";
import {
  newPasswordField,
  passwordField,
} from "../passwords/password-rules.js";
import {
  readSessionCookie,
  sessionCookie,
} from "../sessions/session-cookie.js";
import { displayNameField } from "./display-name-field.js";

const setupBody = z.strictObject({
  displayName: displayNameField,
  password: newPasswordField,
});

const loginBody = z.strictObject({ password: passwordField });

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
  // Every Set-Cookie, including the clearing one, carries the same attributes,
  // so a browser always replaces the cookie it already holds.
  const cookie = (token: string, maxAgeSeconds: number) =>
    sessionCookie(token, maxAgeSeconds, settings.secureCookie);

  server.get("/auth/state", async (request) =>
    auth.state(readSessionCookie(request.headers.cookie), request.log),
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
      .header("set-cookie", cookie(token, maxAgeSeconds))
      .send(await auth.state(token, request.log));
  });

  server.post("/auth/login", async (request, reply) => {
    const body = loginBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const result = await auth.logIn(body.data.password);
    if (result.kind === "setup_required") {
      return sendApiError(
        reply,
        401,
        "setup_required",
        "The account is not set up yet",
      );
    }
    if (result.kind === "too_many_attempts") {
      // The header serves generic HTTP clients; the body field serves the web app.
      return sendApiError(
        reply.header("retry-after", String(result.retryAfterSeconds)),
        429,
        "too_many_attempts",
        "Too many wrong passwords; wait before trying again",
        { retryAfterSeconds: result.retryAfterSeconds },
      );
    }
    if (result.kind === "invalid_password") {
      return sendApiError(
        reply,
        401,
        "invalid_password",
        "The password is incorrect",
      );
    }

    const { token, maxAgeSeconds } = result.session;
    return reply
      .header("set-cookie", cookie(token, maxAgeSeconds))
      .send(await auth.state(token, request.log));
  });

  // Always succeeds: a browser with no session, or a stale one, is already
  // logged out, and it still gets the cookie cleared.
  server.post("/auth/logout", async (request, reply) => {
    await auth.logOut(readSessionCookie(request.headers.cookie));
    return reply.status(204).header("set-cookie", cookie("", 0)).send();
  });
}
