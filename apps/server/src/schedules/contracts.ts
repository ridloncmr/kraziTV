import type { FastifyBaseLogger } from "fastify";

/**
 * The per-call logger a schedule mutation writes to: `request.log` from
 * routes, `server.log` from hooks. Passed per call because the service is
 * built before the Fastify logger exists.
 */
export type ScheduleLog = Pick<FastifyBaseLogger, "info" | "warn">;

/** A channel's persisted schedule bookkeeping. */
export interface ScheduleState {
  channelId: string;
  seed: number;
  anchorTime: number;
  lastGeneratedThrough: number;
  nextSequenceNumber: number;
  scheduleRevision: number;
  /** The effective time of the last schedule mutation. */
  updatedAt: number;
}

/** Why an enabled channel cannot be scheduled; the API reports the same values. */
type ChannelUnschedulableReason =
  "no_programming_block" | "no_schedulable_media";

export type EnsureCoverageResult =
  | { kind: "channel_not_found" }
  | { kind: "disabled" }
  | { kind: "unschedulable"; reason: ChannelUnschedulableReason }
  | { kind: "covered"; scheduleRevision: number }
  /** Coverage ended at or before now; nothing is backfilled. */
  | { kind: "schedule_gap" };
