import type { EpisodeHints, PathHints } from "@krazitv/media";

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
  /** This scan's lookups by outcome; each counts items, not TMDB calls. */
  matchedCount: number;
  ambiguousCount: number;
  unmatchedCount: number;
  lookupErrorCount: number;
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
  /**
   * A `scan` runs every phase; a `retry` repeats lookups for cataloged items
   * through `enriching -> committing` only, so its discovery and probe counts
   * stay zero.
   */
  kind: "scan" | "retry";
  phase:
    | "discovering"
    | "probing"
    | "enriching"
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
  /** Items this scan looks up on TMDB; final once `enriching` starts. */
  lookupCount: number;
  /** Items whose lookup settled, whatever its outcome. */
  lookedUpCount: number;
  /** The most recently settled lookup's title; null outside `enriching`. */
  currentTitle: string | null;
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
 * Whether a retry job started, or why it did not: any reason a scan gives,
 * an unknown or removed scope item, or no TMDB key to look anything up with.
 */
export type RetryStart =
  ScanStart | { kind: "item_not_found" } | { kind: "tmdb_key_missing" };

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

/**
 * One file as enrichment sees it: its identity, its probed duration when it
 * probed, and its path hints. A scan's candidates and a retry's cataloged
 * items both fit.
 */
export interface HintedCandidate {
  candidate: Pick<CatalogCandidate, "pathKey"> &
    ({ status: "available"; durationMs: number } | { status: "probe_failed" });
  hints: PathHints | undefined;
}

/** One available file a lookup group decides for. */
interface LookupFile {
  pathKey: string;
  hints: PathHints;
  durationMs: number;
}

/**
 * Files that share one TMDB search: movies with the same title and year, or
 * episodes under one series folder with the same series name and year. The
 * hints are the search's own; a series' name is its title.
 */
export type LookupGroup = {
  hints: { title: string; year?: number; strength: PathHints["strength"] };
} & (
  | { kind: "movie"; files: LookupFile[] }
  | { kind: "series"; files: (LookupFile & { episode: EpisodeHints })[] }
);

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
