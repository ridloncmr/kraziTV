import type { FastifyInstance } from "fastify";
import { currentPathPlatform, normalizeMediaPath } from "@krazitv/media";
import { z } from "zod";

import {
  sendApiError,
  sendInvalidRequest,
  sendMediaRootNotFound,
} from "../http/api-error.js";
import { toApiTimestamp, toApiTimestampOrNull } from "../http/api-timestamp.js";
import { idParams } from "../http/request-schemas.js";
import type { ApiScanStatus } from "../catalog-scan/contracts.js";
import type { RemovedPathReclaim } from "../catalog-removal/contracts.js";
import type { MediaRoot } from "./contracts.js";
import type { MediaRootRepository } from "./media-root-repository.js";

const createBody = z.strictObject({
  path: z.string(),
  enabled: z.boolean().optional(),
});

const updateBody = z.strictObject({
  enabled: z.boolean(),
});

/**
 * Registers media-root HTTP routes; validation and status mapping live only
 * here. `scanStatus` answers each listed root's current or latest scan job,
 * so this domain carries scan status without knowing how scans run.
 * `reclaimRemovedPath` frees a path a removed root still holds, so this
 * domain can re-add one without knowing how removal and purge work.
 */
export function registerMediaRootRoutes(
  server: FastifyInstance,
  mediaRoots: MediaRootRepository,
  scanStatus: (rootId: string) => ApiScanStatus | null,
  reclaimRemovedPath: (pathKey: string) => Promise<RemovedPathReclaim>,
): void {
  const platform = currentPathPlatform();

  server.get("/media-roots", async () => {
    const roots = await mediaRoots.list();
    return roots.map((root) => ({
      ...toApiMediaRoot(root),
      scan: scanStatus(root.id),
    }));
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

    const enabled = body.data.enabled ?? true;
    let result = await mediaRoots.create(rootPath, enabled);
    // A removed root waiting for purge still holds its path; free it and retry once.
    if (result.kind === "duplicate") {
      const reclaim = await reclaimRemovedPath(rootPath.pathKey);
      if (reclaim.kind === "removal_pending") {
        return sendApiError(
          reply,
          409,
          "media_root_removal_pending",
          `A removed media root at ${rootPath.path} still airs until ${toApiTimestamp(reclaim.airingUntil)}; add it again after that`,
          { airingUntil: toApiTimestamp(reclaim.airingUntil) },
        );
      }
      if (reclaim.kind === "reclaimed") {
        result = await mediaRoots.create(rootPath, enabled);
      }
    }
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
      return sendMediaRootNotFound(reply, id);
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
