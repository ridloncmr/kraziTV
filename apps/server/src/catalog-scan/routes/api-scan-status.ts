import { SUPPORTED_MEDIA_EXTENSIONS } from "@krazitv/media";

import {
  toApiTimestamp,
  toApiTimestampOrNull,
} from "../../http/api-timestamp.js";
import type { ApiScanStatus, ScanStatus, ScanSummary } from "../contracts.js";

/**
 * The one scan status wire mapping, shared by the scan routes and the
 * media-root listing: epoch milliseconds become the ISO 8601 strings the API
 * promises.
 */
export function toApiScanStatus(status: ScanStatus): ApiScanStatus {
  return {
    ...status,
    startedAt: toApiTimestamp(status.startedAt),
    finishedAt: toApiTimestampOrNull(status.finishedAt),
    summary: status.summary && toApiScanSummary(status.summary),
  };
}

/**
 * Keeps today's completed-scan facts in the same shape the synchronous scan
 * returned, plus the extensions discovery accepts, so a scan that found
 * nothing can say what kraziTV looks for without the web app keeping a copy.
 */
function toApiScanSummary(summary: ScanSummary): ApiScanStatus["summary"] {
  return {
    rootId: summary.rootId,
    startedAt: toApiTimestamp(summary.startedAt),
    completedAt: toApiTimestamp(summary.completedAt),
    discoveredCount: summary.discoveredCount,
    probedCount: summary.probedCount,
    probeFailedCount: summary.probeFailedCount,
    missingCount: summary.missingCount,
    matchedCount: summary.matchedCount,
    ambiguousCount: summary.ambiguousCount,
    unmatchedCount: summary.unmatchedCount,
    lookupErrorCount: summary.lookupErrorCount,
    supportedExtensions: [...SUPPORTED_MEDIA_EXTENSIONS],
  };
}
