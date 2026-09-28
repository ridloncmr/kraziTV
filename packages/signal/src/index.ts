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

export interface SignalSession {
  readonly output: Readable;
  append(item: SignalPlayoutItem): Promise<void>;
  stop(): Promise<void>;
}
