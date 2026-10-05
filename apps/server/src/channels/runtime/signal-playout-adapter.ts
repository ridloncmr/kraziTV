import type {
  ChannelAuthorization,
  ChannelAuthorizationResult,
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  PlayoutProvider,
} from "@krazitv/signal";

import type { PlayoutService } from "../../playout/playout-service.js";
import type { ScheduleLog } from "../../schedules/contracts.js";
import type { ChannelRepository } from "../repository/channel-repository.js";
import {
  playoutFailureError,
  toCurrentPlayoutResult,
  toFollowingPlayoutResult,
} from "./signal-playout-mapping.js";

/**
 * Serves channel stream workers from kraziBrain's playout reads. It binds the
 * server logger because the signal ports take none, and keeps database shapes
 * out of `@krazitv/signal`.
 */
export class SignalPlayoutAdapter
  implements PlayoutProvider, ChannelAuthorization
{
  readonly #playout: PlayoutService;
  readonly #channels: Pick<ChannelRepository, "findById">;
  readonly #log: ScheduleLog;

  // The log is fixed here because worker calls carry no request logger.
  constructor(
    playout: PlayoutService,
    channels: Pick<ChannelRepository, "findById">,
    log: ScheduleLog,
  ) {
    this.#playout = playout;
    this.#channels = channels;
    this.#log = log;
  }

  /** Reports whether a worker may start for the channel; never throws for state. */
  async getChannelAuthorization(
    channelId: string,
  ): Promise<ChannelAuthorizationResult> {
    const channel = await this.#channels.findById(channelId);
    if (channel === undefined) return { status: "not_found", channelId };
    return { status: channel.enabled ? "enabled" : "disabled", channelId };
  }

  /** Answers what airs at `atMs`; a channel that went away mid-broadcast throws. */
  async getCurrent(
    channelId: string,
    atMs: number,
  ): Promise<CurrentPlayoutResult> {
    const state = await this.#playout.getCurrent(channelId, atMs, this.#log);
    if (state.kind !== "current" && state.kind !== "no_current") {
      throw playoutFailureError(state, channelId);
    }
    return toCurrentPlayoutResult(state);
  }

  /** Selects up to `count` items after the cursor entry for preparation. */
  async getFollowing(
    channelId: string,
    afterScheduleEntryId: string,
    count: number,
  ): Promise<FollowingPlayoutResult> {
    const following = await this.#playout.getFollowing(
      channelId,
      afterScheduleEntryId,
      count,
      this.#log,
    );
    if ("kind" in following) throw playoutFailureError(following, channelId);
    return toFollowingPlayoutResult(following);
  }
}
