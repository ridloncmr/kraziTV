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
import { isForeignOrigin, isLoopbackOrigin } from "../gate/request-origin.js";
import { displayNameField } from "./display-name-field.js";
import { sendTooManyAttempts } from "./too-many-attempts.js";

const setupBody = z.strictObject({
  displayName: displayNameField,
  password: newPasswordField,
});

const loginBody = z.strictObject({ password: passwordField });

const stateQuery = z.object({ origin: z.string().optional() });

/** Settings fixed at startup from parsed configuration. */
interface AuthRouteSettings {
  /** True when the public base URL is https, so the cookie is sent only over TLS. */
  secureCookie: boolean;
  /** The origins the auth gate accepts writes from. */
  allowedOrigins: ReadonlySet<string>;
  /** Where to send a browser whose own address cannot write. */
  publicBaseUrl: string;
}

/** Decides the advice `GET /auth/state` gives a page at `origin`; see there. */
function wrongAddress(origin: string | undefined, settings: AuthRouteSettings) {
  if (
    origin === undefined ||
    !isForeignOrigin("POST", origin, settings.allowedOrigins)
  ) {
    return null;
  }
  return isLoopbackOrigin(settings.publicBaseUrl) && !isLoopbackOrigin(origin)
    ? { kind: "configure" as const }
    : { kind: "open" as const, url: settings.publicBaseUrl };
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

  // `origin` is the web app's own address. When the gate would refuse its
  // writes, `wrongAddress` says what works, so the owner is not handed a
  // form that can only fail: open the public base URL, or, when that names
  // the server's own computer and this browser is elsewhere, configure one.
  // It is advice only: writes are still judged by their own Origin header.
  server.get("/auth/state", async (request) => {
    // A malformed query gets no advice rather than an error.
    const origin = stateQuery.safeParse(request.query).data?.origin;
    return {
      ...(await auth.state(
        readSessionCookie(request.headers.cookie),
        request.log,
      )),
      wrongAddress: wrongAddress(origin, settings),
    };
  });

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
      return sendTooManyAttempts(reply, result.retryAfterSeconds);
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
