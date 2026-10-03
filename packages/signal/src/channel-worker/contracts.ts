import type { ChannelBroadcastSubscription } from "../channel-broadcast/channel-broadcast-subscription.js";
import type { ChannelId, ScheduleEntryId } from "../playout/contracts.js";
import type { TimestampMs } from "../runtime/clock.js";

/** The item a worker's session is transmitting, and when its boundary falls. */
export type AiringItem = {
  scheduleEntryId: ScheduleEntryId;
  endsAt: TimestampMs;
};

/** The dependency call a transition was waiting on; named in deadline failures. */
export type TransitionStep =
  | "following_lookup"
  | "current_lookup"
  | "prepare"
  | "commit"
  | "discard"
  | "recovery";

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
