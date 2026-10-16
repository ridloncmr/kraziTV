import { describe, expect, it } from "vitest";

import type {
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  SelectedPlayoutItem,
} from "../playout/contracts.js";
import {
  cursorOf,
  requireCurrent,
  selectContiguousFollowing,
  toFollowingSignalItem,
  toSignalItem,
} from "./playout-projection.js";

type SelectedProgram = Extract<SelectedPlayoutItem, { kind: "program" }>;

const item = (
  scheduleRevision: number,
  overrides: Partial<SelectedProgram> = {},
): SelectedProgram => ({
  kind: "program",
  channelId: "channel-1",
  scheduleEntryId: "entry-1",
  scheduleRevision,
  mediaItemId: "media-1",
  mediaPath: "C:/media/movie.mkv",
  hasAudio: true,
  hasVideo: true,
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
  overrides: Partial<SelectedProgram> = {},
): Extract<CurrentPlayoutResult, { status: "current" }> => ({
  status: "current",
  channelId: "channel-1",
  scheduleRevision: 1,
  evaluatedAt,
  mediaOffsetMs,
  item: item(1, overrides),
});

describe("playout projection stream layout", () => {
  it("carries the media's audio and video facts to packaging", () => {
    const layout = { hasAudio: false, hasVideo: false };

    expect(
      toSignalItem(current(4_000, 4_000, layout), "channel-1"),
    ).toMatchObject(layout);
    expect(
      toFollowingSignalItem(item(1, { startsAt: 10_000, ...layout })),
    ).toMatchObject(layout);
  });
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

describe("planned filler projection", () => {
  type SelectedFiller = Extract<SelectedPlayoutItem, { kind: "filler" }>;
  const filler = (overrides: Partial<SelectedFiller> = {}): SelectedFiller => ({
    kind: "filler",
    channelId: "channel-1",
    scheduleRevision: 1,
    startsAt: 10_000,
    endsAt: 15_000,
    message: "Programming resumes at 8:00 PM",
    ...overrides,
  });
  const tunedAt = (
    evaluatedAt: number,
    overrides: Partial<SelectedFiller> = {},
  ): Extract<CurrentPlayoutResult, { status: "current" }> => ({
    status: "current",
    channelId: "channel-1",
    scheduleRevision: 1,
    evaluatedAt,
    mediaOffsetMs: evaluatedAt - 10_000,
    item: filler(overrides),
  });
  const selected = (item: SelectedPlayoutItem): FollowingPlayoutResult => ({
    status: "selected",
    channelId: "channel-1",
    scheduleRevision: 1,
    items: [item],
  });

  it("names a program by its entry and filler by its end", () => {
    expect(cursorOf(item(1))).toEqual({
      kind: "program",
      scheduleEntryId: "entry-1",
    });
    expect(cursorOf(filler())).toEqual({ kind: "filler", endsAt: 15_000 });
  });

  it("packages filler joined mid-way for only its remaining airtime", () => {
    expect(toSignalItem(tunedAt(12_000), "channel-1")).toEqual({
      kind: "filler",
      channelId: "channel-1",
      message: "Programming resumes at 8:00 PM",
      airtimeMs: 3_000,
    });
    expect(toFollowingSignalItem(filler())).toMatchObject({ airtimeMs: 5_000 });
  });

  it.each([
    { name: "at its end", current: tunedAt(15_000) },
    { name: "before its start", current: tunedAt(9_000) },
    { name: "with no message", current: tunedAt(12_000, { message: "" }) },
  ])("refuses filler joined $name", ({ current }) => {
    expect(() => toSignalItem(current, "channel-1")).toThrow(
      expect.objectContaining({ code: "invalid_playout_item" }),
    );
  });

  it("accepts following filler only when it starts at the boundary and has airtime", () => {
    expect(
      selectContiguousFollowing(selected(filler()), "channel-1", 10_000),
    ).toEqual(filler());
    expect(
      selectContiguousFollowing(selected(filler()), "channel-1", 9_000),
    ).toBeUndefined();
    expect(
      selectContiguousFollowing(
        selected(filler({ endsAt: 10_000 })),
        "channel-1",
        10_000,
      ),
    ).toBeUndefined();
  });
});
