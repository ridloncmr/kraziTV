import type { ChannelId } from "../playout/contracts.js";
import type { ChannelBroadcastSubscription } from "../channel-broadcast/channel-broadcast-subscription.js";

export interface ManagedChannelWorker {
  readonly channelId: ChannelId;
  readonly completion: Promise<void>;
  /** Creates a viewer only while this worker remains joinable. */
  trySubscribe(): ChannelBroadcastSubscription | undefined;
  /** Settles all runtime resources owned by this worker. */
  stop(): Promise<void>;
}

export interface ChannelWorkerFactory<TWorker extends ManagedChannelWorker> {
  /** Starts one privately held worker for later manager publication. */
  create(channelId: ChannelId, signal: AbortSignal): Promise<TWorker>;
}
