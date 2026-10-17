// Test-only ChannelRuntime that records stops and fails when the test says so.
import type { ChannelStopReason } from "@krazitv/signal";

import type { ChannelRuntime } from "../channels/contracts.js";

export interface RecordedStop {
  channelId: string;
  reason: ChannelStopReason;
}

/**
 * Records every stopChannel and scheduleChanged call in order. A test can
 * make stops fail by setting `failure`, hold a stop open with `onStop`, and
 * make notices throw, as the real manager never does, with `noticeFailure`.
 */
export class RecordingChannelRuntime implements ChannelRuntime {
  readonly stops: RecordedStop[] = [];
  /** The channel of each schedule-change notice, in call order. */
  readonly scheduleChanges: string[] = [];
  /** When set, every notice throws this error after it is recorded. */
  noticeFailure: Error | undefined;
  /** When set, every stop rejects with this error after onStop settles. */
  failure: Error | undefined;
  /** Runs inside each stop before it settles, while the request still waits. */
  onStop: ((stop: RecordedStop) => Promise<void> | void) | undefined;

  /** Records the notice, then throws when the test arranged a failure. */
  scheduleChanged(channelId: string): void {
    this.scheduleChanges.push(channelId);
    if (this.noticeFailure !== undefined) throw this.noticeFailure;
  }

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
