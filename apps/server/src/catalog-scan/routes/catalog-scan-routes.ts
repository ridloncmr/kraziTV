import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  sendApiError,
  sendInvalidRequest,
  sendMediaItemNotFound,
  sendMediaRootNotFound,
} from "../../http/api-error.js";
import { idParams } from "../../http/request-schemas.js";
import type { MediaRootRepository } from "../../media-roots/media-root-repository.js";
import type { RetryStart } from "../contracts.js";
import type { CatalogScanner } from "../scanner/catalog-scanner.js";
import { toApiScanStatus } from "./api-scan-status.js";

// A retry names one item, the folder holding one item, or a root's failed lookups.
const retryBody = z.union([
  z.strictObject({
    scope: z.enum(["item", "folder"]),
    mediaItemId: z.string(),
  }),
  z.strictObject({ scope: z.literal("failed"), mediaRootId: z.string() }),
]);

/**
 * Registers the scan job routes: start, read, and cancel one root's scan,
 * and start a lookup retry, which is read and cancelled as its root's scan.
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
    return sendScanStart(reply, await scanner.start(id), {
      root: `Media root ${id}`,
      notFound: () => sendMediaRootNotFound(reply, id),
    });
  });

  server.post("/metadata/lookup-retries", async (request, reply) => {
    const body = retryBody.safeParse(request.body);
    if (!body.success) return sendInvalidRequest(reply, body.error);
    const scope = body.data;
    const result = await scanner.retry(scope);
    if (scope.scope === "failed") {
      const id = scope.mediaRootId;
      return sendScanStart(reply, result, {
        root: `Media root ${id}`,
        notFound: () => sendMediaRootNotFound(reply, id),
      });
    }
    const id = scope.mediaItemId;
    return sendScanStart(reply, result, {
      root: `The media root of item ${id}`,
      notFound: () => sendMediaItemNotFound(reply, id),
    });
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

/**
 * Maps each start outcome of a scan or retry to its HTTP status and
 * structured error code. `root` names the media root in messages, and
 * `notFound` answers for the resource the request addressed.
 */
function sendScanStart(
  reply: FastifyReply,
  result: RetryStart,
  { root, notFound }: { root: string; notFound: () => FastifyReply },
): FastifyReply {
  switch (result.kind) {
    case "started":
      return reply.status(202).send(toApiScanStatus(result.status));
    case "root_not_found":
    case "item_not_found":
      return notFound();
    case "root_disabled":
      return sendApiError(
        reply,
        409,
        "media_root_disabled",
        `${root} is disabled; enable it before scanning`,
      );
    case "scan_in_progress":
      return sendApiError(
        reply,
        409,
        "scan_in_progress",
        `${root} is already being scanned`,
      );
    case "tmdb_key_missing":
      return sendApiError(
        reply,
        409,
        "tmdb_key_required",
        "Set up TMDB in Account Settings first.",
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
