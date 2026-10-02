import type { ChannelSubscription } from "../channel-broadcast/contracts.js";
import type { ChannelId } from "../playout/contracts.js";

export type ChannelSubscribeOptions = {
  signal?: AbortSignal;
};

export type ChannelStopReason = "disabled" | "deleted";

export interface ChannelStreamManagerContract {
  /** Joins one viewer to the channel's shared broadcast signal. */
  subscribe(
    channelId: ChannelId,
    options?: ChannelSubscribeOptions,
  ): Promise<ChannelSubscription>;
  /** Immediately settles one channel's runtime after an administrative change. */
  stopChannel(channelId: ChannelId, reason: ChannelStopReason): Promise<void>;
  /** Permanently rejects new work and settles all owned workers. */
  shutdown(): Promise<void>;
}

export type { ChannelSubscription };
