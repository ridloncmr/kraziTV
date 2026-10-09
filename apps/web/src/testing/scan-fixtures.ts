import type { MediaRoot, ScanStatus } from "../http/contracts.js";

/** A wire scan status for root `root`; tests override only the facts they assert. */
export function scanStatus(overrides: Partial<ScanStatus> = {}): ScanStatus {
  return {
    id: "scan-1",
    rootId: "root",
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
    ...overrides,
  };
}
