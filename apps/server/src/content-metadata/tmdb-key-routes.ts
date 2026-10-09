import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendApiError, sendInvalidRequest } from "../http/api-error.js";
import type { TmdbKeyService } from "./tmdb-key-service.js";

// A pasted token often carries stray spaces; TMDB tokens never contain one.
// The cap only bounds the body; real tokens are a few hundred characters.
const tmdbKeyBody = z.strictObject({
  apiKey: z.string().trim().min(1).max(2_000),
});

/**
 * Registers the owner's TMDB key routes. They sit behind the auth gate, and
 * every answer is `{ configured }`: no route ever returns the key (ADR 0013).
 * Nothing here logs the request body, which is the only place the key appears.
 */
export function registerTmdbKeyRoutes(
  server: FastifyInstance,
  tmdbKeys: TmdbKeyService,
): void {
  server.get("/metadata/tmdb-key", async () => ({
    configured: await tmdbKeys.isConfigured(),
  }));

  // A rejected key answers 400, not 401: the web app leaves the desktop on
  // any 401, and this browser is still logged in.
  server.put("/metadata/tmdb-key", async (request, reply) => {
    const body = tmdbKeyBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const check = await tmdbKeys.save(body.data.apiKey);
    if (check.kind === "superseded") {
      return sendApiError(
        reply,
        409,
        "tmdb_key_changed",
        "Another request changed the TMDB key. Check its current status before saving again.",
      );
    }
    if (check.kind === "rejected") {
      return sendApiError(
        reply,
        400,
        "invalid_tmdb_key",
        "TMDB did not accept this key. Check that you pasted your API Read Access Token.",
      );
    }
    if (check.kind === "unreachable") {
      request.log.warn(
        { reason: check.reason },
        "Could not reach TMDB to check a key",
      );
      return sendApiError(
        reply,
        502,
        "tmdb_unreachable",
        "kraziTV could not reach TMDB to check this key. Try again later.",
      );
    }
    return { configured: true };
  });

  server.delete("/metadata/tmdb-key", async () => {
    await tmdbKeys.remove();
    return { configured: false };
  });
}
