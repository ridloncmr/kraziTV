import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendApiError, sendInvalidRequest } from "../../http/api-error.js";
import type { AuthService } from "../auth-service.js";
import { AVATAR_IDS } from "../avatars.js";
import { displayNameField } from "./display-name-field.js";

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
}
