import type { ChannelSubscription } from "../channel-broadcast/contracts.js";
import type { ChannelId } from "../playout/contracts.js";

export type ChannelSubscribeOptions = {
  signal?: AbortSignal;
};

/**
 * Why an administrative stop ended a channel's runtime. `interrupted` means
 * the user chose to replace what was airing; the channel stays enabled.
 */
export type ChannelStopReason = "disabled" | "deleted" | "interrupted";

export interface ChannelStreamManagerContract {
  /** Joins one viewer to the channel's shared broadcast signal. */
  subscribe(
    channelId: ChannelId,
    options?: ChannelSubscribeOptions,
  ): Promise<ChannelSubscription>;
  /**
   * Tells a running channel stream worker its schedule changed, so it crosses
   * early when a cut moved the airing item's end. A no-op without a worker.
   */
  scheduleChanged(channelId: ChannelId): void;
  /** Immediately settles one channel's runtime after an administrative change. */
  stopChannel(channelId: ChannelId, reason: ChannelStopReason): Promise<void>;
  /** Permanently rejects new work and settles all owned workers. */
  shutdown(): Promise<void>;
}

export type { ChannelSubscription };
