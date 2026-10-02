import type { Readable } from "node:stream";

import type {
  ChannelId,
  MediaItemId,
  ScheduleEntryId,
} from "../playout/contracts.js";
import type { DurationMs } from "../runtime/clock.js";

export type SignalPlayoutItem = {
  channelId: ChannelId;
  scheduleEntryId: ScheduleEntryId;
  mediaItemId: MediaItemId;
  mediaPath: string;
  /** Precomputed source layout; packaging must not probe provider media. */
  hasAudio: boolean;
  /** Absolute source-media position where this item starts emitting. */
  mediaOffsetMs: DurationMs;
  /**
   * Maximum emission time, not a promise to fill it: the next commit or stop
   * truncates the tail. The worker enforces the scheduled end, not this value.
   */
  playDurationMs: DurationMs;
};

export interface SignalPackager {
  start(initialItem: SignalPlayoutItem): SignalSession;
}

export interface SignalPreparation {
  /**
   * Synchronously and irrevocably makes this item the session's output,
   * starting it and truncating the previous item. If the previous item ended
   * first, output stays open and idle until this commit.
   */
  commit(): void;
  /** Releases an uncommitted preparation. This operation is idempotent. */
  discard(): Promise<void>;
}

export interface SignalSession {
  /** Resolves only after usable initialization and media output exists. */
  readonly ready: Promise<void>;
  /**
   * Settles only when the whole session ends through stop or fatal failure.
   * Ending an individual item, or any FFmpeg process that served it, is
   * internal to the session and must not settle completion.
   */
  readonly completion: Promise<void>;
  readonly output: Readable;
  prepare(item: SignalPlayoutItem): Promise<SignalPreparation>;
  /**
   * The session alone owns release of what it prepares; the worker stops it
   * concurrently with its transition loop and relies on stop to end any
   * preparation that loop is still waiting for.
   * Once called, an in-flight prepare() rejects with `packaging_stopped` and an
   * in-flight discard() settles before stop settles, and later prepare() calls
   * reject. Stop resolves only after every FFmpeg process, including one
   * still stopping after a commit, has exited; a failed stop may be retried.
   * After stop, discard() is a no-op and commit() throws.
   */
  stop(): Promise<void>;
}
