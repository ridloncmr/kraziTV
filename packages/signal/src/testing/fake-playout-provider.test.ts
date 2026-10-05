import { describe, expect, it } from "vitest";

import type { CurrentPlayoutResult, FollowingPlayoutResult } from "../index.js";
import { FakePlayoutProvider } from "./fake-playout-provider.js";

const currentResult: CurrentPlayoutResult = {
  status: "current",
  channelId: "comedy",
  scheduleRevision: 4,
  evaluatedAt: 1_000,
  mediaOffsetMs: 250,
  item: {
    channelId: "comedy",
    scheduleEntryId: "entry-1",
    scheduleRevision: 4,
    mediaItemId: "media-1",
    mediaPath: "/media/1.mkv",
    hasAudio: true,
    hasVideo: true,
    title: "Pilot",
    startsAt: 750,
    endsAt: 30_750,
    durationMs: 30_000,
    startOffsetMs: 0,
  },
};

const followingResult: FollowingPlayoutResult = {
  status: "selected",
  channelId: "comedy",
  scheduleRevision: 4,
  items: [],
};

describe("FakePlayoutProvider", () => {
  it("returns queued atomic projections and records calls", async () => {
    const provider = new FakePlayoutProvider();
    provider.enqueueCurrent(currentResult);
    provider.enqueueFollowing(followingResult);

    await expect(provider.getCurrent("comedy", 1_000)).resolves.toBe(
      currentResult,
    );
    await expect(provider.getFollowing("comedy", "entry-1", 2)).resolves.toBe(
      followingResult,
    );

    expect(provider.currentCalls).toEqual([
      { channelId: "comedy", atMs: 1_000 },
    ]);
    expect(provider.followingCalls).toEqual([
      { channelId: "comedy", afterScheduleEntryId: "entry-1", count: 2 },
    ]);
  });

  it("fails clearly when a test did not arrange a result", async () => {
    const provider = new FakePlayoutProvider();

    await expect(provider.getCurrent("comedy", 1_000)).rejects.toThrow(
      /no current playout result/i,
    );
  });
});
