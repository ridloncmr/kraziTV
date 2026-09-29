import type {
  ChannelId,
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  PlayoutProvider,
  ScheduleEntryId,
} from "../playout/contracts.js";

export class FakePlayoutProvider implements PlayoutProvider {
  readonly currentCalls: Array<{ channelId: ChannelId; atMs: number }> = [];
  readonly followingCalls: Array<{
    channelId: ChannelId;
    afterScheduleEntryId: ScheduleEntryId;
    count: number;
  }> = [];
  private readonly currentResults: CurrentPlayoutResult[] = [];
  private readonly followingResults: FollowingPlayoutResult[] = [];
  private readonly revisions = new Map<ChannelId, number>();

  enqueueCurrent(result: CurrentPlayoutResult): void {
    this.currentResults.push(result);
  }

  enqueueFollowing(result: FollowingPlayoutResult): void {
    this.followingResults.push(result);
  }

  setScheduleRevision(channelId: ChannelId, revision: number): void {
    this.revisions.set(channelId, revision);
  }

  async getCurrent(
    channelId: ChannelId,
    atMs: number,
  ): Promise<CurrentPlayoutResult> {
    this.currentCalls.push({ channelId, atMs });
    const result = this.currentResults.shift();
    if (!result) throw new Error("No current playout result was arranged");
    return result;
  }

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

  async getScheduleRevision(channelId: ChannelId): Promise<number> {
    const revision = this.revisions.get(channelId);
    if (revision === undefined) {
      throw new Error(`No schedule revision was arranged for ${channelId}`);
    }
    return revision;
  }
}
