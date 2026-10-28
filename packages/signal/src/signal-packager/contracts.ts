import type { Readable } from "node:stream";

import type {
  ChannelId,
  MediaItemId,
  ScheduleEntryId,
} from "../playout/contracts.js";
import type { DurationMs } from "../runtime/clock.js";

/** One program a session transmits from its media. */
type ProgramSignalItem = {
  kind: "program";
  channelId: ChannelId;
  scheduleEntryId: ScheduleEntryId;
  mediaItemId: MediaItemId;
  mediaPath: string;
  /** Precomputed source layout; packaging must not probe provider media. */
  hasAudio: boolean;
  /** False for audio-only media, which is packaged over black video. */
  hasVideo: boolean;
  /** Absolute source-media position where this item starts emitting. */
  mediaOffsetMs: DurationMs;
  /**
   * Maximum source-media emission time, not a promise to fill it: the next
   * commit or stop truncates the tail. The worker enforces the scheduled end,
   * not this value.
   */
  playDurationMs: DurationMs;
  /**
   * Black video and silence emitted after the media when it is shorter than
   * its airtime, so the signal stays continuous to the boundary.
   */
  blackTailMs: DurationMs;
};

/**
 * Planned filler as kraziBrain chose it (ADR 0014): black video showing
 * `message` over silence for `airtimeMs`. No media input; packaging never
 * decides its timing or wording.
 */
type FillerSignalItem = {
  kind: "filler";
  channelId: ChannelId;
  /** The text shown, already formatted, such as "Programming resumes at 8:00 PM". */
  message: string;
  airtimeMs: DurationMs;
};

/** What a session transmits next: a program or planned filler. */
export type SignalPlayoutItem = ProgramSignalItem | FillerSignalItem;

export interface SignalPackager {
  start(initialItem: SignalPlayoutItem): SignalSession;
}

export interface SignalPreparation {
  /**
   * Synchronously and irrevocably makes this item the session's output,
   * starting it and truncating the previous item. If the previous item ended
   * first, output stays open and idle until this commit. A preparation whose
   * process already failed commits its stand-in.
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
   * internal to the session and must not settle completion. An item whose
   * media is missing, or whose process fails before or after its commit or
   * falls silent while airing, airs a stand-in card until the next commit
   * instead (ADR 0020); only a stand-in that fails too is fatal.
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
