/** The facts a completed scan reports; the summary of a `completed` scan job. */
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

/**
 * A snapshot of one scan job: the server's in-memory record of one scan of
 * one root. Times are epoch milliseconds; counters only grow.
 */
export interface ScanStatus {
  /** Unique within the server process, so a client can tell its job from a newer one. */
  id: string;
  rootId: string;
  phase:
    | "discovering"
    | "probing"
    | "committing"
    | "completed"
    | "failed"
    | "cancelled";
  startedAt: number;
  finishedAt: number | null;
  /** Grows during discovery; final once probing starts. */
  discoveredCount: number;
  /** Probes that settled, whether they succeeded or failed. */
  settledCount: number;
  probeFailedCount: number;
  /** The most recently settled probe's path; null outside `probing`. */
  currentPath: string | null;
  cancelRequested: boolean;
  /** Non-null only when phase is `completed`. */
  summary: ScanSummary | null;
  /** Non-null only when phase is `failed`. */
  error: {
    code:
      | "media_root_unavailable"
      | "media_root_disabled"
      | "media_root_not_found"
      | "scan_failed";
    message: string;
  } | null;
}

/** Whether a scan job started, or why it did not. */
export type ScanStart =
  | { kind: "started"; status: ScanStatus }
  | RootRejection
  | { kind: "scan_in_progress" }
  | { kind: "shutting_down" };

/**
 * The wire form of a scan status, with ISO 8601 timestamps. Defined here so
 * media-root routes can carry it without importing the scan routes.
 */
export interface ApiScanStatus extends Omit<
  ScanStatus,
  "startedAt" | "finishedAt" | "summary"
> {
  startedAt: string;
  finishedAt: string | null;
  summary:
    | (Omit<ScanSummary, "startedAt" | "completedAt"> & {
        startedAt: string;
        completedAt: string;
      })
    | null;
}

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
    | {
        status: "available";
        durationMs: number;
        hasAudio: boolean;
        hasVideo: boolean;
      }
    | { status: "probe_failed"; probeError: string }
  );
