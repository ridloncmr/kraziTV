// Wire shape of a catalog scan job's status.
interface ScanSummary {
  discoveredCount: number;
  probedCount: number;
  probeFailedCount: number;
  missingCount: number;
  /** This scan's TMDB lookups by outcome, counted in items. */
  matchedCount: number;
  ambiguousCount: number;
  unmatchedCount: number;
  lookupErrorCount: number;
}
/** One scan job's status; every scan dialog state derives from it. */
export interface ScanStatus {
  id: string;
  rootId: string;
  /** A `retry` repeats TMDB lookups only, so it never discovers or probes. */
  kind: "scan" | "retry";
  phase:
    | "discovering"
    | "probing"
    | "enriching"
    | "committing"
    | "completed"
    | "failed"
    | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  discoveredCount: number;
  settledCount: number;
  probeFailedCount: number;
  currentPath: string | null;
  /** Items the scan looks up on TMDB; zero when it looked nothing up. */
  lookupCount: number;
  lookedUpCount: number;
  /** The most recently looked-up title; null outside `enriching`. */
  currentTitle: string | null;
  cancelRequested: boolean;
  /** Non-null only when phase is `completed`. */
  summary: ScanSummary | null;
  /** Non-null only when phase is `failed`. */
  error: { code: string; message: string } | null;
}
