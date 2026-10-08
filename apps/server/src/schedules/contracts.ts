import type { PlaybackMode } from "@krazitv/krazi-brain";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";

/**
 * The per-call logger a schedule mutation writes to: `request.log` from
 * routes, `server.log` from hooks. Passed per call because the service is
 * built before the Fastify logger exists.
 */
export type ScheduleLog = Pick<FastifyBaseLogger, "info" | "warn">;

/** Why a schedule input changed or a channel regenerated; logged with each affected channel's outcome. */
export type ScheduleChangeReason =
  | "block_created"
  | "block_changed"
  | "block_deleted"
  | "membership_changed"
  | "media_removed"
  | "manual";

/**
 * Writes a scheduling input inside the schedule transaction at its effective
 * time, and names the channels whose schedules the write affects.
 * `interruptedChannelIds` names the affected channels whose airing entry
 * the user explicitly chose to interrupt; ADR 0003 allows nothing else to.
 * `afterRegeneration` runs in the same transaction once every affected
 * channel's first chunk is written, for work that needs the regenerated
 * schedule, such as purging media no entry holds any more. It receives the
 * channels whose revision this commit already advanced, so it never
 * advances one twice (ADR 0003).
 */
export type ScheduleInputChange<T> = (
  trx: Kysely<DatabaseSchema>,
  effectiveNow: number,
) => Promise<{
  value: T;
  affectedChannelIds: readonly string[];
  interruptedChannelIds?: readonly string[];
  afterRegeneration?: (
    trx: Kysely<DatabaseSchema>,
    advancedChannelIds: ReadonlySet<string>,
  ) => Promise<void>;
}>;

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
  /** The requested instant lies past the request limit; nothing is written. */
  | { kind: "through_out_of_range"; latestThrough: number };

/** One chunk committed entries but coverage still falls short of the target. */
export type ChunkResult = EnsureCoverageResult | { kind: "extended" };

/** A channel cleared to generate: it exists, is enabled, and its target is in range. */
export interface ChannelAdmission {
  kind: "admitted";
  state: ScheduleState | undefined;
  effectiveNow: number;
  target: number;
}

/** The first check that refused a channel generation, in check order. */
export type AdmissionFailure = Extract<
  EnsureCoverageResult,
  { kind: "channel_not_found" | "disabled" | "through_out_of_range" }
>;

/** Where one chunk of generation starts. */
export interface ChunkStart {
  seed: number;
  startsAt: number;
  nextSequenceNumber: number;
}

/** Entries and progress one chunk wrote, before the caller records state. */
export type WrittenChunk =
  | {
      kind: "written";
      lastGeneratedThrough: number;
      nextSequenceNumber: number;
      insertedEntryCount: number;
    }
  | Extract<EnsureCoverageResult, { kind: "unschedulable" }>;

/** What one regeneration removed and rebuilt; logged once it commits. */
interface Regeneration {
  /** Where the rebuilt entries start. */
  boundary: number;
  /** The start of the airing entry an interrupt deleted, when one did. */
  interruptedFrom?: number | undefined;
  deletedEntryCount: number;
  insertedEntryCount: number;
  /** Where coverage had already ended, when the regeneration repaired a gap. */
  uncoveredFrom?: number | undefined;
}

/** A channel's first chunk inside a transaction, with its regeneration when one ran. */
export interface ChannelChunk {
  channelId: string;
  result: ChunkResult;
  /** Whether the chunk advanced the channel's schedule revision. */
  revisionAdvanced?: boolean | undefined;
  regeneration?: Regeneration | undefined;
}

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
