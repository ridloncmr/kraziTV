import type { ChannelSubscription } from "../channel-broadcast/channel-broadcast-subscription.js";
import type { ChannelId } from "../playout/contracts.js";

export type ChannelSubscribeOptions = {
  signal?: AbortSignal;
};

export interface ChannelStreamManagerContract {
  /** Joins one viewer to the channel's shared broadcast signal. */
  subscribe(
    channelId: ChannelId,
    options?: ChannelSubscribeOptions,
  ): Promise<ChannelSubscription>;
  /** Permanently rejects new work and settles all owned workers. */
  shutdown(): Promise<void>;
}

export type { ChannelSubscription };
