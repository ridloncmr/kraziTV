import type { ChannelBroadcastSubscription } from "../channel-broadcast/channel-broadcast-subscription.js";
import type { ChannelId, ScheduleEntryId } from "../playout/contracts.js";

export type ChannelAuthorizationResult =
  | { status: "enabled"; channelId: ChannelId }
  | { status: "disabled"; channelId: ChannelId }
  | { status: "not_found"; channelId: ChannelId };

export interface ChannelAuthorization {
  getChannelAuthorization(
    channelId: ChannelId,
  ): Promise<ChannelAuthorizationResult>;
}

export type TransitionCandidate = {
  channelId: ChannelId;
  scheduleEntryId: ScheduleEntryId;
  scheduleRevision: number;
};

export interface TransitionCoordinator {
  commitPreparedTransition(
    candidate: TransitionCandidate,
    commit: () => void,
  ): Promise<"committed" | "stale">;
}

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
