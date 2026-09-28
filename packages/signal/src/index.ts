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
  /**
   * Resolves only after the session has produced usable stream initialization
   * and media output. Process spawn or an arbitrary first byte is not ready.
   */
  readonly ready: Promise<void>;
  readonly output: Readable;
  prepare(item: SignalPlayoutItem): Promise<SignalPreparation>;
  stop(): Promise<void>;
}
