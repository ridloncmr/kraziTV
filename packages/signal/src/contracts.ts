import type { Readable } from "node:stream";

/** UTC Unix epoch milliseconds. */
export type TimestampMs = number;
/** An integer duration in milliseconds, constrained by its use. */
export type DurationMs = number;

export type ChannelId = string;
export type ScheduleEntryId = string;
export type MediaItemId = string;

export type SignalPlayoutItem = {
  channelId: ChannelId;
  scheduleEntryId: ScheduleEntryId;
  mediaItemId: MediaItemId;
  mediaPath: string;
  mediaOffsetMs: DurationMs;
  playDurationMs: DurationMs;
};

export type SelectedPlayoutItem = {
  channelId: ChannelId;
  scheduleEntryId: ScheduleEntryId;
  scheduleRevision: number;
  mediaItemId: MediaItemId;
  mediaPath: string;
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
  | {
      status: "stale_cursor";
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
  getScheduleRevision(channelId: ChannelId): Promise<number>;
}

export type ChannelAuthorizationResult =
  | { status: "enabled"; channelId: ChannelId }
  | { status: "disabled"; channelId: ChannelId }
  | { status: "not_found"; channelId: ChannelId };

export interface ChannelAuthorization {
  getChannelAuthorization(
    channelId: ChannelId,
  ): Promise<ChannelAuthorizationResult>;
}

export type TransitionCandidate = {
  channelId: ChannelId;
  scheduleEntryId: ScheduleEntryId;
  scheduleRevision: number;
};

export interface TransitionCoordinator {
  commitPreparedTransition(
    candidate: TransitionCandidate,
    commit: () => void,
  ): Promise<"committed" | "stale">;
}

export interface SignalPackager {
  start(initialItem: SignalPlayoutItem): SignalSession;
}

export interface SignalPreparation {
  /** Synchronously and irrevocably accepts this prepared item. */
  commit(): void;
  /** Releases an uncommitted preparation. This operation is idempotent. */
  discard(): Promise<void>;
}

export interface SignalSession {
  /** Resolves only after usable initialization and media output exists. */
  readonly ready: Promise<void>;
  readonly output: Readable;
  prepare(item: SignalPlayoutItem): Promise<SignalPreparation>;
  stop(): Promise<void>;
}

export interface Clock {
  now(): TimestampMs;
}

export interface ScheduledTask {
  readonly active: boolean;
  cancel(): void;
}

export interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: DurationMs): ScheduledTask;
}

export type LogContext = Readonly<Record<string, unknown>>;

export interface SignalLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
