import type { MovieLookup, PathHints } from "@krazitv/media";

/** What a looked-up decision's stored evidence holds: its hints and the query sent. */
export interface MatchEvidence {
  hints: PathHints;
  query: MovieLookup["query"];
}

/**
 * Reads a looked-up decision's evidence column. Only lookups write `query`,
 * so a caller reads evidence only for an ambiguous, matched, or rejected item.
 */
export function readMatchEvidence(evidence: string): MatchEvidence {
  return JSON.parse(evidence) as MatchEvidence;
}
