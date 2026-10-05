import type {
  ChannelId,
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  PlayoutProvider,
  ScheduleEntryId,
} from "../playout/contracts.js";

/** Answers playout lookups from scripted queues and records every call. */
export class FakePlayoutProvider implements PlayoutProvider {
  readonly currentCalls: Array<{ channelId: ChannelId; atMs: number }> = [];
  readonly followingCalls: Array<{
    channelId: ChannelId;
    afterScheduleEntryId: ScheduleEntryId;
    count: number;
  }> = [];
  private readonly currentResults: CurrentPlayoutResult[] = [];
  private readonly followingResults: FollowingPlayoutResult[] = [];

  /** Queues the answer for the next current lookup, in call order. */
  enqueueCurrent(result: CurrentPlayoutResult): void {
    this.currentResults.push(result);
  }

  /** Queues the answer for the next following lookup, in call order. */
  enqueueFollowing(result: FollowingPlayoutResult): void {
    this.followingResults.push(result);
  }

  /** Throws when nothing was queued, so an unexpected lookup fails the test loudly. */
  async getCurrent(
    channelId: ChannelId,
    atMs: number,
  ): Promise<CurrentPlayoutResult> {
    this.currentCalls.push({ channelId, atMs });
    const result = this.currentResults.shift();
    if (!result) throw new Error("No current playout result was arranged");
    return result;
  }

  /** Throws when nothing was queued, so an unexpected lookup fails the test loudly. */
  async getFollowing(
    channelId: ChannelId,
    afterScheduleEntryId: ScheduleEntryId,
    count: number,
  ): Promise<FollowingPlayoutResult> {
    this.followingCalls.push({ channelId, afterScheduleEntryId, count });
    const result = this.followingResults.shift();
    if (!result) throw new Error("No following playout result was arranged");
    return result;
  }
}
