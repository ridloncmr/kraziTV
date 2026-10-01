import type { FastifyInstance } from "fastify";
import { currentPathPlatform, normalizeMediaPath } from "@krazitv/media";
import { z } from "zod";

import { sendApiError, sendInvalidRequest } from "../http/api-error.js";
import { toApiTimestamp, toApiTimestampOrNull } from "../http/api-timestamp.js";
import { idParams } from "../http/request-schemas.js";
import type { MediaRoot } from "./contracts.js";
import type { MediaRootRepository } from "./media-root-repository.js";

const createBody = z.strictObject({
  path: z.string(),
  enabled: z.boolean().optional(),
});

const updateBody = z.strictObject({
  enabled: z.boolean(),
});

/** Registers media-root HTTP routes; validation and status mapping live only here. */
export function registerMediaRootRoutes(
  server: FastifyInstance,
  mediaRoots: MediaRootRepository,
): void {
  const platform = currentPathPlatform();

  server.get("/media-roots", async () => {
    const roots = await mediaRoots.list();
    return roots.map(toApiMediaRoot);
  });

  server.post("/media-roots", async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const rootPath = normalizeMediaPath(body.data.path, platform);
    if (rootPath === undefined) {
      return sendApiError(
        reply,
        400,
        "invalid_request",
        "path must be a fully qualified absolute path",
      );
    }

    const result = await mediaRoots.create(rootPath, body.data.enabled ?? true);
    if (result.kind === "duplicate") {
      return sendApiError(
        reply,
        409,
        "media_root_duplicate",
        `A media root already exists for ${rootPath.path}`,
      );
    }

    return reply.status(201).send(toApiMediaRoot(result.root));
  });

  server.patch("/media-roots/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    if (isObjectWithKey(request.body, "path")) {
      return sendApiError(
        reply,
        400,
        "media_root_path_immutable",
        "A media root path cannot change; create a new media root instead",
      );
    }

    const body = updateBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const root = await mediaRoots.setEnabled(id, body.data.enabled);
    if (root === undefined) {
      return sendApiError(
        reply,
        404,
        "media_root_not_found",
        `Media root ${id} does not exist`,
      );
    }

    return toApiMediaRoot(root);
  });
}

// Detects a path change before generic validation so the client gets a specific code.
function isObjectWithKey(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && key in value;
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
function toApiMediaRoot(root: MediaRoot) {
  return {
    id: root.id,
    path: root.path,
    enabled: root.enabled,
    createdAt: toApiTimestamp(root.createdAt),
    updatedAt: toApiTimestamp(root.updatedAt),
    lastScannedAt: toApiTimestampOrNull(root.lastScannedAt),
  };
}
