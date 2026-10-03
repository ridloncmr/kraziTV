import type { FastifyInstance, FastifyReply } from "fastify";

import { sendApiError, sendMediaRootNotFound } from "../../http/api-error.js";
import { toApiTimestamp } from "../../http/api-timestamp.js";
import { idParams } from "../../http/request-schemas.js";
import type { ScanResult, ScanSummary } from "../contracts.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import type { CatalogScanner } from "../scanner/catalog-scanner.js";

/**
 * Registers the synchronous scan trigger; status mapping lives only here. A
 * completed scan ensures every enabled channel's schedule before replying,
 * because it may have made a channel schedulable.
 */
export function registerCatalogScanRoutes(
  server: FastifyInstance,
  scanner: CatalogScanner,
  schedules: ScheduleService,
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
    // Logs its own failures, so the scan response never depends on it.
    if (result.kind === "completed") {
      await schedules.ensureAllEnabled(request.log);
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
    startedAt: toApiTimestamp(summary.startedAt),
    completedAt: toApiTimestamp(summary.completedAt),
    discoveredCount: summary.discoveredCount,
    probedCount: summary.probedCount,
    probeFailedCount: summary.probeFailedCount,
    missingCount: summary.missingCount,
  };
}
