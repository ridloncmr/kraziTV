import type { MediaDiscoveryError } from "@krazitv/media";

export interface ScanSummary {
  rootId: string;
  startedAt: number;
  completedAt: number;
  discoveredCount: number;
  probedCount: number;
  probeFailedCount: number;
  /** Items that became `missing` in this scan. */
  missingCount: number;
}

export type ScanResult =
  | { kind: "completed"; summary: ScanSummary }
  | { kind: "root_not_found" }
  | { kind: "root_disabled" }
  | { kind: "scan_in_progress" }
  | { kind: "root_unavailable"; error: MediaDiscoveryError }
  | { kind: "cancelled" };

interface CandidateIdentity {
  path: string;
  pathKey: string;
  title: string;
  /** When this file's probe settled during the scan; becomes `lastProbedAt`. */
  probedAt: number;
}

/**
 * The persistence-free record a scan stages for one discovered file. Future
 * metadata enrichment transforms candidates between creation and validation.
 */
export type CatalogCandidate = CandidateIdentity &
  (
    | { status: "available"; durationMs: number; hasAudio: boolean }
    | { status: "probe_failed"; probeError: string }
  );
