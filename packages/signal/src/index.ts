import type { Readable } from "node:stream";

export type SignalPlayoutItem = {
  channelId: string;
  scheduleEntryId: string;
  mediaItemId: string;
  mediaPath: string;
  mediaOffsetMs: number;
  playDurationMs: number;
};

/**
 * Persisted schedule identity that must still be current when a prepared item
 * is committed. The coordinator, not the channel worker, resolves boundary
 * time and revalidates this identity against authoritative state.
 */
export type TransitionCandidate = {
  channelId: string;
  scheduleEntryId: string;
  scheduleRevision: number;
};

/**
 * Serializes a prepared-item commit with schedule mutation without exposing a
 * database or transaction API to ChannelWorker.
 */
export interface TransitionCoordinator {
  /**
   * Invoke `commit` synchronously while the candidate owns the transition
   * boundary, or leave it untouched and return `stale` when revalidation
   * fails. Errors thrown by `commit` propagate to the caller.
   */
  commitPreparedTransition(
    candidate: TransitionCandidate,
    commit: () => void,
  ): Promise<"committed" | "stale">;
}

export interface SignalPackager {
  start(initialItem: SignalPlayoutItem): SignalSession;
}

export interface SignalPreparation {
  /**
   * Irrevocably accept this prepared item as the session's next transmitted
   * item. This operation is synchronous so a TransitionCoordinator can invoke
   * it while holding the schedule-transition coordination boundary.
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

  /**
   * Prepare only the next possible item. A session has at most one outstanding
   * preparation, and all resources and buffered output used by preparation
   * must be explicitly bounded. Whether this uses a second FFmpeg process is
   * an implementation choice to be settled by the compatibility spike.
   */
  prepare(item: SignalPlayoutItem): Promise<SignalPreparation>;
  stop(): Promise<void>;
}
