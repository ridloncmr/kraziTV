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
  mediaOffsetMs: DurationMs;
  playDurationMs: DurationMs;
};

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
