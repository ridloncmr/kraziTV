import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendApiError, sendInvalidRequest } from "../../http/api-error.js";
import type { AuthService } from "../auth-service.js";
import { AVATAR_IDS } from "../avatars.js";
import {
  newPasswordField,
  passwordField,
} from "../passwords/password-rules.js";
import { readSessionCookie } from "../sessions/session-cookie.js";
import { displayNameField } from "./display-name-field.js";
import { sendTooManyAttempts } from "./too-many-attempts.js";

// avatarId stays a plain string here so an unknown one gets its own code.
const profileBody = z
  .strictObject({
    displayName: displayNameField.optional(),
    avatarId: z.string().optional(),
  })
  .refine(
    (body) => body.displayName !== undefined || body.avatarId !== undefined,
    { message: "Send displayName, avatarId, or both" },
  );

const passwordChangeBody = z.strictObject({
  currentPassword: passwordField,
  newPassword: newPasswordField,
});

/**
 * Registers the logged-in owner's account routes. They sit behind the auth
 * gate, so every handler may assume the one account exists.
 */
export function registerAccountRoutes(
  server: FastifyInstance,
  auth: AuthService,
): void {
  server.patch("/account", async (request, reply) => {
    const body = profileBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const { avatarId } = body.data;
    if (avatarId !== undefined && !AVATAR_IDS.includes(avatarId)) {
      return sendApiError(
        reply,
        400,
        "unknown_avatar",
        `Unknown avatar: ${avatarId}`,
      );
    }
    return auth.updateProfile(body.data);
  });

  // A wrong password answers 400, not 401: the web app leaves the desktop on
  // any 401, and this browser is still logged in.
  server.put("/account/password", async (request, reply) => {
    const body = passwordChangeBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const result = await auth.changePassword(
      readSessionCookie(request.headers.cookie),
      body.data,
    );
    if (result.kind === "too_many_attempts") {
      return sendTooManyAttempts(reply, result.retryAfterSeconds);
    }
    if (result.kind === "invalid_password") {
      return sendApiError(
        reply,
        400,
        "invalid_password",
        "The current password is incorrect",
      );
    }
    return reply.status(204).send();
  });
}
