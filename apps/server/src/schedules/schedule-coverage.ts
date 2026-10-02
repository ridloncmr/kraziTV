import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";

import type {
  ChunkResult,
  EnsureCoverageResult,
  ScheduleState,
} from "./contracts.js";

/**
 * Bounds one synchronous schedule request: a read window's length, and how
 * far past the effective current time a requested instant may reach.
 */
export const SCHEDULE_REQUEST_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns how far coverage must reach: a full horizon past now, or a later
 * requested instant. A floor, never a cap, so every generated chunk inserts
 * at least one entry. Rejects an instant past the request limit.
 */
export function resolveTarget(
  effectiveNow: number,
  through: number | undefined,
): number | Extract<EnsureCoverageResult, { kind: "through_out_of_range" }> {
  const latestThrough = effectiveNow + SCHEDULE_REQUEST_LIMIT_MS;
  if (through !== undefined && through > latestThrough) {
    return { kind: "through_out_of_range", latestThrough };
  }
  return Math.max(through ?? 0, effectiveNow + SCHEDULE_HORIZON_MS);
}

/**
 * Settles a channel whose existing coverage needs no write: a gap when it
 * already ended, covered when it reaches the target. Returns undefined when
 * a chunk must be generated.
 */
export function checkCoverage(
  state: ScheduleState | undefined,
  effectiveNow: number,
  target: number,
): EnsureCoverageResult | undefined {
  if (state === undefined) return undefined;
  if (state.lastGeneratedThrough <= effectiveNow) {
    return { kind: "schedule_gap" };
  }
  if (state.lastGeneratedThrough >= target) {
    return {
      kind: "covered",
      scheduleRevision: state.scheduleRevision,
      generatedThrough: state.lastGeneratedThrough,
    };
  }
  return undefined;
}

/** Reports a committed chunk as covered once it reaches the target, else as still extending. */
export function coverageAfterChunk(
  next: ScheduleState,
  target: number,
): ChunkResult {
  return next.lastGeneratedThrough >= target
    ? {
        kind: "covered",
        scheduleRevision: next.scheduleRevision,
        generatedThrough: next.lastGeneratedThrough,
      }
    : { kind: "extended" };
}
