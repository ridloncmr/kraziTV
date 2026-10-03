import type { Clock } from "@krazitv/signal";
import { describe, expect, it, vi } from "vitest";

import {
  FixedChannelAuthorization,
  FixedSpikePlayoutProvider,
  FixedTransitionCoordinator,
  findMpegTsJoinPoint,
} from "./runtime.js";

const clock = (now: number): Clock => ({ now: () => now });

describe("FixedSpikePlayoutProvider", () => {
  it("alternates the two known assets on one deterministic timeline", async () => {
    const provider = new FixedSpikePlayoutProvider({
      startedAt: 1_000,
      mediaDurationMs: 30_000,
      mediaAPath: "C:/spike/a.mp4",
      mediaBPath: "C:/spike/b.mp4",
    });

    const first = await provider.getCurrent("69", 11_000);
    const second = await provider.getCurrent("69", 31_000);
    const third = await provider.getCurrent("69", 61_000);

    expect(first).toMatchObject({
      status: "current",
      mediaOffsetMs: 10_000,
      item: { mediaPath: "C:/spike/a.mp4", scheduleEntryId: "spike-0-a" },
    });
    expect(second).toMatchObject({
      status: "current",
      mediaOffsetMs: 0,
      item: { mediaPath: "C:/spike/b.mp4", scheduleEntryId: "spike-1-b" },
    });
    expect(third).toMatchObject({
      status: "current",
      mediaOffsetMs: 0,
      item: { mediaPath: "C:/spike/a.mp4", scheduleEntryId: "spike-2-a" },
    });
  });

  it("selects the exact next contiguous item", async () => {
    const provider = new FixedSpikePlayoutProvider({
      startedAt: 1_000,
      mediaDurationMs: 30_000,
      mediaAPath: "a.mp4",
      mediaBPath: "b.mp4",
    });

    const result = await provider.getFollowing("69", "spike-0-a", 1);

    expect(result).toMatchObject({
      status: "selected",
      items: [
        {
          scheduleEntryId: "spike-1-b",
          startsAt: 31_000,
          endsAt: 61_000,
        },
      ],
    });
  });

  it("records each current-state evaluation without exposing its media path", async () => {
    const record = vi.fn();
    const provider = new FixedSpikePlayoutProvider({
      startedAt: 1_000,
      mediaDurationMs: 30_000,
      mediaAPath: "C:/private/a.mp4",
      mediaBPath: "C:/private/b.mp4",
      record,
    });

    await provider.getCurrent("69", 11_000);

    expect(record).toHaveBeenCalledWith("playout_state_evaluated", {
      channelId: "69",
      evaluatedAt: 11_000,
      scheduleEntryId: "spike-0-a",
      mediaItemId: "spike-video-a",
      mediaOffsetMs: 10_000,
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain("private");
  });
});

describe("fixed runtime adapters", () => {
  it("authorizes only Channel 69", async () => {
    const authorization = new FixedChannelAuthorization();
    await expect(authorization.getChannelAuthorization("69")).resolves.toEqual({
      status: "enabled",
      channelId: "69",
    });
    await expect(authorization.getChannelAuthorization("70")).resolves.toEqual({
      status: "not_found",
      channelId: "70",
    });
  });

  it("commits only the item covering the current boundary", async () => {
    const provider = new FixedSpikePlayoutProvider({
      startedAt: 1_000,
      mediaDurationMs: 30_000,
      mediaAPath: "a.mp4",
      mediaBPath: "b.mp4",
    });
    const commit = vi.fn();
    const coordinator = new FixedTransitionCoordinator(provider, clock(31_000));

    await expect(
      coordinator.commitPreparedTransition(
        { channelId: "69", scheduleEntryId: "spike-1-b", scheduleRevision: 1 },
        commit,
      ),
    ).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
  });
});
