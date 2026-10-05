import type { DurationMs, TimestampMs } from "../runtime/clock.js";

export type ChannelId = string;
export type ScheduleEntryId = string;
export type MediaItemId = string;

export type SelectedPlayoutItem = {
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

export type CurrentPlayoutResult =
  | {
      status: "current";
      channelId: ChannelId;
      scheduleRevision: number;
      evaluatedAt: TimestampMs;
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
  // The afterScheduleEntryId the caller passed is no longer on the schedule.
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
    afterScheduleEntryId: ScheduleEntryId,
    count: number,
  ): Promise<FollowingPlayoutResult>;
}
