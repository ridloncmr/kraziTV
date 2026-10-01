import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { sendApiError } from "../../http/api-error.js";
import type {
  CatalogScanner,
  ScanResult,
  ScanSummary,
} from "../scanner/catalog-scanner.js";

const idParams = z.object({ id: z.string() });

/** Registers the synchronous scan trigger; status mapping lives only here. */
export function registerCatalogScanRoutes(
  server: FastifyInstance,
  scanner: CatalogScanner,
): void {
  server.post("/media-roots/:id/scan", async (request, reply) => {
    const { id } = idParams.parse(request.params);

    // A response that closes before it finished means the client went away.
    const controller = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.on("close", onClose);
    // A client that left during routing may have closed the connection before
    // this listener existed; the socket flag is set before any close event fires.
    if (request.raw.socket?.destroyed || reply.raw.destroyed)
      controller.abort();

    let result: ScanResult;
    try {
      result = await scanner.scan(id, { signal: controller.signal });
    } finally {
      // Detach before replying so a finished scan can never be cancelled late.
      reply.raw.off("close", onClose);
    }
    return sendScanResult(reply, id, result);
  });
}

// Maps each scan outcome to its HTTP status and structured error code.
function sendScanResult(
  reply: FastifyReply,
  id: string,
  result: ScanResult,
): FastifyReply | ReturnType<typeof toApiScanSummary> {
  switch (result.kind) {
    case "completed":
      return toApiScanSummary(result.summary);
    case "root_not_found":
      return sendApiError(
        reply,
        404,
        "media_root_not_found",
        `Media root ${id} does not exist`,
      );
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
    case "root_unavailable":
      return sendApiError(
        reply,
        409,
        "media_root_unavailable",
        result.error.message,
      );
    case "cancelled":
      return sendApiError(
        reply,
        503,
        "scan_cancelled",
        "The scan was cancelled before it committed; the catalog is unchanged",
      );
  }
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
function toApiScanSummary(summary: ScanSummary) {
  return {
    rootId: summary.rootId,
    startedAt: new Date(summary.startedAt).toISOString(),
    completedAt: new Date(summary.completedAt).toISOString(),
    discoveredCount: summary.discoveredCount,
    probedCount: summary.probedCount,
    probeFailedCount: summary.probeFailedCount,
    missingCount: summary.missingCount,
  };
}
