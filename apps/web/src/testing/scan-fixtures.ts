import type { MediaRoot } from "../http/contracts/media.js";
import type { ScanStatus } from "../http/contracts/scan.js";

/** A wire scan status for root `root`; tests override only the facts they assert. */
export function scanStatus(overrides: Partial<ScanStatus> = {}): ScanStatus {
  return {
    id: "scan-1",
    rootId: "root",
    kind: "scan",
    phase: "discovering",
    startedAt: "2026-10-07T12:00:00.000Z",
    finishedAt: null,
    discoveredCount: 0,
    settledCount: 0,
    probeFailedCount: 0,
    currentPath: null,
    lookupCount: 0,
    lookedUpCount: 0,
    currentTitle: null,
    cancelRequested: false,
    summary: null,
    error: null,
    ...overrides,
  };
}

/** A completed scan's wire summary with no lookups; tests override only the counts they assert. */
export function scanSummary(
  overrides: Partial<NonNullable<ScanStatus["summary"]>> = {},
): NonNullable<ScanStatus["summary"]> {
  return {
    discoveredCount: 0,
    probedCount: 0,
    probeFailedCount: 0,
    missingCount: 0,
    matchedCount: 0,
    ambiguousCount: 0,
    unmatchedCount: 0,
    lookupErrorCount: 0,
    supportedExtensions: [".mkv"],
    ...overrides,
  };
}

/** An enabled, never-scanned wire media root at `/media` with no scan job. */
export function mediaRoot(overrides: Partial<MediaRoot> = {}): MediaRoot {
  return {
    id: "root",
    path: "/media",
    enabled: true,
    lastScannedAt: null,
    scan: null,
    matchCounts: {
      items: 0,
      matched: 0,
      needsChoice: 0,
      notLookedUp: 0,
      failedLookups: 0,
    },
    ...overrides,
  };
}

/** A root `id` whose lookup job runs, `done` of `total` files so far. */
export function lookingUpRoot(
  id: string,
  done: number,
  total: number,
  kind: "scan" | "retry" = "retry",
): MediaRoot {
  return mediaRoot({
    id,
    path: `/media/${id}`,
    scan: scanStatus({
      id: `job-${id}`,
      rootId: id,
      kind,
      phase: "enriching",
      lookupCount: total,
      lookedUpCount: done,
    }),
  });
}

/**
 * A root `id` whose last lookup job has ended, leaving `notLookedUp` files
 * a lookup would still search for.
 */
export function idleRoot(id: string, notLookedUp = 0): MediaRoot {
  return mediaRoot({
    id,
    path: `/media/${id}`,
    scan: scanStatus({
      id: `job-${id}`,
      rootId: id,
      kind: "retry",
      phase: "completed",
      lookupCount: 50,
      lookedUpCount: 50,
    }),
    matchCounts: {
      items: 50 + notLookedUp,
      matched: 50,
      needsChoice: 0,
      notLookedUp,
      failedLookups: 0,
    },
  });
}
