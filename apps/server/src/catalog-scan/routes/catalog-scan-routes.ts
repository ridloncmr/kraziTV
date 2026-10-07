import type { FastifyInstance, FastifyReply } from "fastify";

import { sendApiError, sendMediaRootNotFound } from "../../http/api-error.js";
import { idParams } from "../../http/request-schemas.js";
import type { MediaRootRepository } from "../../media-roots/media-root-repository.js";
import type { ScanStart } from "../contracts.js";
import type { CatalogScanner } from "../scanner/catalog-scanner.js";
import { toApiScanStatus } from "./api-scan-status.js";

/**
 * Registers the scan job routes: start, read, and cancel one root's scan.
 * Jobs run in the background, so no request's lifetime affects a scan; status
 * mapping lives only here.
 */
export function registerCatalogScanRoutes(
  server: FastifyInstance,
  scanner: CatalogScanner,
  roots: Pick<MediaRootRepository, "findById">,
): void {
  server.post("/media-roots/:id/scan", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return sendScanStart(reply, id, await scanner.start(id));
  });

  server.get("/media-roots/:id/scan", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const status = scanner.status(id);
    if (status === undefined) return sendNoScan(reply, id, roots);
    return toApiScanStatus(status);
  });

  server.delete("/media-roots/:id/scan", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const status = scanner.cancel(id);
    if (status === undefined) return sendNoScan(reply, id, roots);
    return reply.status(202).send(toApiScanStatus(status));
  });
}

// Maps each start outcome to its HTTP status and structured error code.
function sendScanStart(
  reply: FastifyReply,
  id: string,
  result: ScanStart,
): FastifyReply {
  switch (result.kind) {
    case "started":
      return reply.status(202).send(toApiScanStatus(result.status));
    case "root_not_found":
      return sendMediaRootNotFound(reply, id);
    case "root_disabled":
      return sendApiError(
        reply,
        409,
        "media_root_disabled",
        `Media root ${id} is disabled; enable it before scanning`,
      );
    case "scan_in_progress":
      return sendApiError(
        reply,
        409,
        "scan_in_progress",
        `Media root ${id} is already being scanned`,
      );
    case "shutting_down":
      return sendApiError(
        reply,
        503,
        "scan_cancelled",
        "The server is shutting down; the scan did not start",
      );
  }
}

/**
 * Answers a read or cancel when the scanner holds no job: the root is looked
 * up only now, so a held job is returned even after its root was removed.
 */
async function sendNoScan(
  reply: FastifyReply,
  id: string,
  roots: Pick<MediaRootRepository, "findById">,
): Promise<FastifyReply> {
  if ((await roots.findById(id)) === undefined) {
    return sendMediaRootNotFound(reply, id);
  }
  return sendApiError(
    reply,
    404,
    "scan_not_found",
    `Media root ${id} has not been scanned since the server started`,
  );
}
