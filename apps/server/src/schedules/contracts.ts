import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { PlaybackMode } from "../database/schema/programming-block-table.js";

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
  | { kind: "covered"; scheduleRevision: number; generatedThrough: number }
  /** Coverage ended at or before now; nothing is backfilled. */
  | { kind: "schedule_gap" }
  /** The requested instant lies past the request limit; nothing is written. */
  | { kind: "through_out_of_range"; latestThrough: number };

/** One persisted schedule entry, in epoch milliseconds. */
export interface ScheduleEntry {
  id: string;
  channelId: string;
  mediaItemId: string;
  title: string;
  startsAt: number;
  endsAt: number;
  durationMs: number;
  sequenceNumber: number;
  programmingBlockId: string | null;
  mediaCollectionId: string | null;
  playbackMode: PlaybackMode | null;
  playbackIndex: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * A channel's entries overlapping a window, read in one snapshot with the
 * revision they belong to. The revision is null before the first generation.
 */
export interface ScheduleWindow {
  scheduleRevision: number | null;
  entries: ScheduleEntry[];
}
