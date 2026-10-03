// Test-only coverage writer for playout reads; production code must never import this module.
import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";

import type { EnsureCoverageResult } from "../schedules/contracts.js";

export interface UnwrittenCoverage {
  /** Always reports coverage through a horizon past `now`, writing nothing. */
  ensureCoverage(): Promise<EnsureCoverageResult>;
  now: () => number;
  /** How many times `ensureCoverage` was called. */
  readonly calls: number;
}

/**
 * Returns a coverage writer that claims coverage without writing it, as when
 * another writer wins the race, so a playout read's retry still finds
 * coverage short.
 */
export function unwrittenCoverage(now: () => number): UnwrittenCoverage {
  let calls = 0;
  return {
    async ensureCoverage() {
      calls += 1;
      return {
        kind: "covered",
        scheduleRevision: 1,
        generatedThrough: now() + SCHEDULE_HORIZON_MS,
      };
    },
    now,
    get calls() {
      return calls;
    },
  };
}
