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
    kind: "program",
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
    await expect(
      provider.getFollowing(
        "comedy",
        { kind: "program", scheduleEntryId: "entry-1" },
        2,
      ),
    ).resolves.toBe(followingResult);

    expect(provider.currentCalls).toEqual([
      { channelId: "comedy", atMs: 1_000 },
    ]);
    expect(provider.followingCalls).toEqual([
      {
        channelId: "comedy",
        after: { kind: "program", scheduleEntryId: "entry-1" },
        count: 2,
      },
    ]);
  });

  it("holds a current lookup open until a queued promise settles", async () => {
    const provider = new FakePlayoutProvider();
    let release = (): void => {};
    provider.enqueueCurrent(
      new Promise<CurrentPlayoutResult>((resolve) => {
        release = () => resolve(currentResult);
      }),
    );
    provider.enqueueCurrent(currentResult);
    let settled = false;
    const first = provider.getCurrent("comedy", 1_000).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await first;

    expect(settled).toBe(true);
    await expect(provider.getCurrent("comedy", 1_250)).resolves.toBe(
      currentResult,
    );
  });

  it("fails clearly when a test did not arrange a result", async () => {
    const provider = new FakePlayoutProvider();

    await expect(provider.getCurrent("comedy", 1_000)).rejects.toThrow(
      /no current playout result/i,
    );
  });
});
