import type { Readable } from "node:stream";

export type BroadcastSubscriptionCloseReason =
  "closed" | "buffer_limit_exceeded" | "source_ended" | "source_failed";

export interface ChannelSubscription {
  readonly stream: Readable;
  /** Releases this viewer without affecting the shared channel signal. */
  close(): void;
}
