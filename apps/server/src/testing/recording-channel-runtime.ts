// Test-only ChannelRuntime that records stops and fails when the test says so.
import type { ChannelStopReason } from "@krazitv/signal";

import type { ChannelRuntime } from "../channels/contracts.js";

export interface RecordedStop {
  channelId: string;
  reason: ChannelStopReason;
}

/**
 * Records every stopChannel call in order. A test can make stops fail by
 * setting `failure`, and can observe or hold a stop open with `onStop`.
 */
export class RecordingChannelRuntime implements ChannelRuntime {
  readonly stops: RecordedStop[] = [];
  /** When set, every stop rejects with this error after onStop settles. */
  failure: Error | undefined;
  /** Runs inside each stop before it settles, while the request still waits. */
  onStop: ((stop: RecordedStop) => Promise<void> | void) | undefined;

  /** Records the stop, runs the test hook, then settles or fails as configured. */
  async stopChannel(
    channelId: string,
    reason: ChannelStopReason,
  ): Promise<void> {
    const stop = { channelId, reason };
    this.stops.push(stop);
    await this.onStop?.(stop);
    if (this.failure !== undefined) throw this.failure;
  }
}
