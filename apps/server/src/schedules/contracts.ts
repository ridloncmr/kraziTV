import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";

/**
 * The per-call logger a schedule mutation writes to: `request.log` from
 * routes, `server.log` from hooks. Passed per call because the service is
 * built before the Fastify logger exists.
 */
export type ScheduleLog = Pick<FastifyBaseLogger, "info" | "warn">;

/** Why a schedule input changed; logged with each affected channel's outcome. */
export type ScheduleChangeReason = "block_created";

/**
 * Writes a scheduling input inside the schedule transaction at its effective
 * time, and names the channels whose schedules the write affects.
 */
export type ScheduleInputChange<T> = (
  trx: Kysely<DatabaseSchema>,
  effectiveNow: number,
) => Promise<{ value: T; affectedChannelIds: readonly string[] }>;

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
