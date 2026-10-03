import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";

import type {
  ChannelChunk,
  ChunkResult,
  EnsureCoverageResult,
  ScheduleLog,
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
 * Settles a channel whose existing coverage needs no write because it
 * already reaches the target. Returns undefined when a chunk must be
 * generated.
 */
export function checkCoverage(
  state: ScheduleState | undefined,
  target: number,
): EnsureCoverageResult | undefined {
  if (state === undefined) return undefined;
  return state.lastGeneratedThrough >= target ? covered(state) : undefined;
}

/** Reports a committed chunk as covered once it reaches the target, else as still extending. */
export function coverageAfterChunk(
  next: ScheduleState,
  target: number,
): ChunkResult {
  return next.lastGeneratedThrough >= target
    ? covered(next)
    : { kind: "extended" };
}

// One shape for "covered", so a pre-check and a fresh chunk report coverage identically.
function covered(
  state: ScheduleState,
): Extract<EnsureCoverageResult, { kind: "covered" }> {
  return {
    kind: "covered",
    scheduleRevision: state.scheduleRevision,
    generatedThrough: state.lastGeneratedThrough,
  };
}

/**
 * Returns the later of the clock and the last schedule mutation, so a clock
 * stepping backward can never move generation before earlier work. Pure, so
 * a read-only snapshot computes the same target a coverage write aims for.
 */
export function effectiveNow(
  now: number,
  lastMutation: number | undefined,
): number {
  return lastMutation === undefined ? now : Math.max(now, lastMutation);
}

/**
 * Returns the effective current time for a schedule mutation, and logs when
 * the clock is behind the last mutation, with the caller's context.
 */
export function clampToLastMutation(
  now: number,
  lastMutation: number | undefined,
  log: ScheduleLog,
  context: Readonly<Record<string, unknown>> = {},
): number {
  const effective = effectiveNow(now, lastMutation);
  if (effective !== now) {
    log.warn(
      { ...context, now, effectiveNow: effective },
      "Clock is behind the last schedule mutation; using the mutation's time",
    );
  }
  return effective;
}

/**
 * Warns once a committed chunk repaired a gap, with its uncovered interval,
 * so the repair is recorded even if completing coverage then fails.
 */
export function warnIfGapRepaired(chunk: ChannelChunk, log: ScheduleLog): void {
  const { channelId, regeneration } = chunk;
  if (regeneration?.uncoveredFrom === undefined) return;
  log.warn(
    {
      channelId,
      uncoveredFrom: regeneration.uncoveredFrom,
      uncoveredUntil: regeneration.boundary,
      deletedEntryCount: regeneration.deletedEntryCount,
    },
    "Repaired a schedule gap; the uncovered interval stays empty",
  );
}
