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

/** Why a root may not receive a scan: it is gone or switched off. */
export type RootRejection =
  { kind: "root_not_found" } | { kind: "root_disabled" };

export type ScanResult =
  | { kind: "completed"; summary: ScanSummary }
  | RootRejection
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
