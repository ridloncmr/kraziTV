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
