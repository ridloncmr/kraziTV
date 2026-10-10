import {
  currentPathPlatform,
  derivePathHints,
  fallbackTitle,
  mediaPathSegments,
  type DiscoveredMediaFile,
  type MediaProbeError,
  type MediaProbeResult,
  type PathHints,
} from "@krazitv/media";

import type { CatalogCandidate } from "../contracts.js";

/** How one discovered file's probe ended, captured before any persistence. */
export type ProbeOutcome =
  | { kind: "probed"; probedAt: number; result: MediaProbeResult }
  | { kind: "failed"; probedAt: number; error: MediaProbeError };

/**
 * Joins discovery and probe results into the scan's normalized candidate
 * shape. The title comes from the file's path hints below its media root, so
 * every scan, including a rescan, refreshes it.
 */
export function createCatalogCandidate(
  file: Pick<DiscoveredMediaFile, "path" | "pathKey" | "title">,
  outcome: ProbeOutcome,
  rootPath: string,
): CatalogCandidate {
  const hints = pathHintsBelow(rootPath, file.path);
  const identity = {
    path: file.path,
    pathKey: file.pathKey,
    title: hints ? fallbackTitle(hints, file.title) : file.title,
    probedAt: outcome.probedAt,
  };
  if (outcome.kind === "probed") {
    return {
      ...identity,
      status: "available",
      durationMs: outcome.result.durationMs,
      hasAudio: outcome.result.hasAudio,
      hasVideo: outcome.result.hasVideo,
    };
  }
  // The code prefix keeps failure kinds, such as timeouts, distinguishable.
  return {
    ...identity,
    status: "probe_failed",
    probeError: `${outcome.error.code}: ${outcome.error.message}`,
  };
}

/**
 * Reads a discovered file's path hints from the folders below its media root,
 * or undefined when the path is not below it. Titles and lookups both use it.
 */
export function pathHintsBelow(
  rootPath: string,
  path: string,
): PathHints | undefined {
  const segments = mediaPathSegments(rootPath, path, currentPathPlatform());
  return segments ? derivePathHints(segments) : undefined;
}

/**
 * Enforces the catalog's status invariants at the last point before
 * persistence, so any future enrichment that breaks them fails the scan here
 * rather than as an opaque SQLite constraint error mid-transaction.
 */
export function validateCatalogCandidate(candidate: CatalogCandidate): void {
  const problem = findProblem(candidate);
  if (problem !== undefined) {
    throw new Error(
      `Invalid catalog candidate for ${candidate.path}: ${problem}`,
    );
  }
}

// Returns the first violated invariant, or undefined for a valid candidate.
function findProblem(candidate: CatalogCandidate): string | undefined {
  if (candidate.path.length === 0 || candidate.pathKey.length === 0) {
    return "path and identity key are required";
  }
  if (candidate.title.trim().length === 0) {
    return "title is required";
  }
  if (!Number.isSafeInteger(candidate.probedAt) || candidate.probedAt < 0) {
    return "probe time must be a non-negative safe integer";
  }
  if (candidate.status === "available") {
    return Number.isSafeInteger(candidate.durationMs) &&
      candidate.durationMs > 0
      ? undefined
      : "duration must be a positive safe integer of milliseconds";
  }
  return candidate.probeError.trim().length > 0
    ? undefined
    : "probe failure must carry an error message";
}
