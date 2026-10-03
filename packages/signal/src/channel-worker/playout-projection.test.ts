import { describe, expect, it } from "vitest";

import type {
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  SelectedPlayoutItem,
} from "../playout/contracts.js";
import {
  requireCurrent,
  selectContiguousFollowing,
  toFollowingSignalItem,
  toSignalItem,
} from "./playout-projection.js";

const item = (
  scheduleRevision: number,
  overrides: Partial<SelectedPlayoutItem> = {},
): SelectedPlayoutItem => ({
  channelId: "channel-1",
  scheduleEntryId: "entry-1",
  scheduleRevision,
  mediaItemId: "media-1",
  mediaPath: "C:/media/movie.mkv",
  hasAudio: true,
  title: "Movie",
  startsAt: 0,
  endsAt: 10_000,
  durationMs: 10_000,
  startOffsetMs: 0,
  ...overrides,
});

const current = (
  evaluatedAt: number,
  mediaOffsetMs: number,
  overrides: Partial<SelectedPlayoutItem> = {},
): Extract<CurrentPlayoutResult, { status: "current" }> => ({
  status: "current",
  channelId: "channel-1",
  scheduleRevision: 1,
  evaluatedAt,
  mediaOffsetMs,
  item: item(1, overrides),
});

describe("current playout projection timing", () => {
  it("plays the remaining airtime with no black tail when media covers it", () => {
    expect(
      toSignalItem(current(4_000, 4_000, { durationMs: 12_000 }), "channel-1"),
    ).toMatchObject({
      mediaOffsetMs: 4_000,
      playDurationMs: 6_000,
      blackTailMs: 0,
    });
  });

  it("clamps play to the remaining media and fills the rest with a black tail", () => {
    expect(
      toSignalItem(current(4_000, 4_000, { durationMs: 7_000 }), "channel-1"),
    ).toMatchObject({
      mediaOffsetMs: 4_000,
      playDurationMs: 3_000,
      blackTailMs: 3_000,
    });
  });

  it("rejects a current offset with no media left to play", () => {
    expect(() =>
      toSignalItem(current(4_000, 7_000, { durationMs: 7_000 }), "channel-1"),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_playout_item",
        details: { channelId: "channel-1", reason: "invalid_current_timing" },
      }),
    );
  });
});

describe("following playout projection timing", () => {
  it("plays the full airtime with no black tail when media covers it", () => {
    expect(
      toFollowingSignalItem(
        item(1, { startsAt: 10_000, endsAt: 20_000, durationMs: 15_000 }),
      ),
    ).toMatchObject({
      mediaOffsetMs: 0,
      playDurationMs: 10_000,
      blackTailMs: 0,
    });
  });

  it("clamps media shorter than its airtime and fills the rest with a black tail", () => {
    expect(
      toFollowingSignalItem(
        item(1, { startsAt: 10_000, endsAt: 20_000, durationMs: 4_000 }),
      ),
    ).toMatchObject({
      mediaOffsetMs: 0,
      playDurationMs: 4_000,
      blackTailMs: 6_000,
    });
  });

  it("treats a following item with no media left to play as unselectable", () => {
    const result: FollowingPlayoutResult = {
      status: "selected",
      channelId: "channel-1",
      scheduleRevision: 1,
      items: [item(1, { durationMs: 2_000, startOffsetMs: 2_000 })],
    };

    expect(selectContiguousFollowing(result, "channel-1", 0)).toBeUndefined();
  });
});

describe("playout projection revision validation", () => {
  it("rejects a current item from a different schedule revision", () => {
    const result: CurrentPlayoutResult = {
      status: "current",
      channelId: "channel-1",
      scheduleRevision: 8,
      evaluatedAt: 1_000,
      mediaOffsetMs: 1_000,
      item: item(7),
    };

    expect(() => requireCurrent(result, "channel-1")).toThrowError(
      expect.objectContaining({
        code: "invalid_playout_item",
        details: {
          channelId: "channel-1",
          reason: "schedule_revision_mismatch",
        },
      }),
    );
  });

  it("treats a following item from a different schedule revision as stale", () => {
    const result: FollowingPlayoutResult = {
      status: "selected",
      channelId: "channel-1",
      scheduleRevision: 8,
      items: [item(7)],
    };

    expect(selectContiguousFollowing(result, "channel-1", 0)).toBeUndefined();
  });
});
