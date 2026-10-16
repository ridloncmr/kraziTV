import type { DurationMs, TimestampMs } from "../runtime/clock.js";

export type ChannelId = string;
export type ScheduleEntryId = string;
export type MediaItemId = string;

/**
 * Where a worker continues from: a program by its schedule entry, or
 * planned filler by its end, which stays fixed while it airs (ADR 0014).
 */
export type PlayoutCursor =
  | { kind: "program"; scheduleEntryId: ScheduleEntryId }
  | { kind: "filler"; endsAt: TimestampMs };

/** A program to transmit from its media. */
type SelectedProgram = {
  kind: "program";
  channelId: ChannelId;
  scheduleEntryId: ScheduleEntryId;
  scheduleRevision: number;
  mediaItemId: MediaItemId;
  mediaPath: string;
  /** Provider-neutral media inspection results used by downstream packaging. */
  hasAudio: boolean;
  hasVideo: boolean;
  title: string;
  startsAt: TimestampMs;
  endsAt: TimestampMs;
  durationMs: DurationMs;
  startOffsetMs: DurationMs;
};

/**
 * Planned filler kraziBrain chose: black video with `message`, already
 * worded and formatted by the adapter, until `endsAt`, when programming
 * resumes.
 */
type SelectedFiller = {
  kind: "filler";
  channelId: ChannelId;
  scheduleRevision: number;
  startsAt: TimestampMs;
  endsAt: TimestampMs;
  message: string;
};

/** What airs: a program or planned filler. */
export type SelectedPlayoutItem = SelectedProgram | SelectedFiller;

export type CurrentPlayoutResult =
  | {
      status: "current";
      channelId: ChannelId;
      scheduleRevision: number;
      evaluatedAt: TimestampMs;
      /** Where in the program's media to join; for filler, the join offset into it. */
      mediaOffsetMs: DurationMs;
      item: SelectedPlayoutItem;
    }
  | {
      status: "no_current";
      channelId: ChannelId;
      scheduleRevision: number;
      evaluatedAt: TimestampMs;
      reason: "schedule_gap" | "media_unavailable";
      scheduleEntryId?: ScheduleEntryId;
    };

export type FollowingPlayoutResult =
  | {
      status: "selected";
      channelId: ChannelId;
      scheduleRevision: number;
      items: readonly SelectedPlayoutItem[];
    }
  // The cursor the caller passed no longer names a program or filler.
  | {
      status: "stale_entry";
      channelId: ChannelId;
      scheduleRevision: number;
      items: readonly [];
    };

/** Each operation returns one complete, atomic schedule projection. */
export interface PlayoutProvider {
  getCurrent(
    channelId: ChannelId,
    atMs: TimestampMs,
  ): Promise<CurrentPlayoutResult>;
  getFollowing(
    channelId: ChannelId,
    after: PlayoutCursor,
    count: number,
  ): Promise<FollowingPlayoutResult>;
}
