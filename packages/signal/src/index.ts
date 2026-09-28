import type { Readable } from "node:stream";

export type SignalPlayoutItem = {
  channelId: string;
  scheduleEntryId: string;
  mediaItemId: string;
  mediaPath: string;
  mediaOffsetMs: number;
  playDurationMs: number;
};

export interface SignalPackager {
  start(initialItem: SignalPlayoutItem): SignalSession;
}

export interface SignalPreparation {
  /**
   * Irrevocably accept this prepared item as the session's next transmitted
   * item. This operation is synchronous so the worker can call it while it
   * owns the schedule-transition coordination boundary.
   */
  commit(): void;

  /** Release resources for an uncommitted preparation. This is idempotent. */
  discard(): Promise<void>;
}

export interface SignalSession {
  readonly output: Readable;
  prepare(item: SignalPlayoutItem): Promise<SignalPreparation>;
  stop(): Promise<void>;
}
