import { describe, expect, it } from "vitest";

import type {
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  SelectedPlayoutItem,
} from "../playout/contracts.js";
import {
  requireCurrent,
  selectContiguousFollowing,
} from "./playout-projection.js";

const item = (scheduleRevision: number): SelectedPlayoutItem => ({
  channelId: "channel-1",
  scheduleEntryId: "entry-1",
  scheduleRevision,
  mediaItemId: "media-1",
  mediaPath: "C:/media/movie.mkv",
  title: "Movie",
  startsAt: 0,
  endsAt: 10_000,
  durationMs: 10_000,
  startOffsetMs: 0,
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
