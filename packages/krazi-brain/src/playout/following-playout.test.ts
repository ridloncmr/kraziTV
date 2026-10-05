import { describe, expect, it } from "vitest";

import {
  HALF_HOUR_MS,
  halfHourPlayoutEntry,
} from "../testing/playout-entries.js";
import type { FollowingPlayout, PlayoutEntry } from "./contracts.js";
import { selectFollowingPlayout } from "./following-playout.js";

const MINUTE_MS = 60 * 1000;
const CHANNEL_ID = "channel_69";
const SCHEDULE_REVISION = 12;

const cursor = halfHourPlayoutEntry("entry_cursor", 0);
const first = halfHourPlayoutEntry("entry_1", 1);
const second = halfHourPlayoutEntry("entry_2", 2);
const third = halfHourPlayoutEntry("entry_3", 3);

// Selects the example channel's following items after an existing cursor.
function following(
  candidates: readonly PlayoutEntry[],
  count: number,
  from: PlayoutEntry = cursor,
): FollowingPlayout {
  return selectFollowingPlayout({
    channelId: CHANNEL_ID,
    scheduleRevision: SCHEDULE_REVISION,
    cursor: from,
    candidates,
    count,
  });
}

// The selected items' entry IDs, so stop-condition tests read as sequences.
function selectedIds(result: FollowingPlayout): string[] {
  expect(result.status).toBe("selected");
  return result.items.map((item) => item.scheduleEntryId);
}

describe("selectFollowingPlayout", () => {
  it("returns the first count contiguous playable items with the revision", () => {
    const result = following([first, second, third], 2);

    expect(result).toEqual({
      status: "selected",
      channelId: CHANNEL_ID,
      scheduleRevision: SCHEDULE_REVISION,
      items: [
        {
          type: "program",
          channelId: CHANNEL_ID,
          scheduleRevision: SCHEDULE_REVISION,
          scheduleEntryId: "entry_1",
          mediaItemId: first.mediaItemId,
          mediaPath: first.media.path,
          hasAudio: true,
          hasVideo: true,
          title: first.title,
          startsAt: first.startsAt,
          endsAt: first.endsAt,
          durationMs: HALF_HOUR_MS,
          startOffsetMs: 0,
          createdAt: first.createdAt,
          updatedAt: first.updatedAt,
        },
        expect.objectContaining({ scheduleEntryId: "entry_2" }),
      ],
    });
  });

  it("returns every candidate when fewer than count are contiguous and playable", () => {
    expect(selectedIds(following([first, second], 5))).toEqual([
      "entry_1",
      "entry_2",
    ]);
  });

  it("stops at a time gap", () => {
    const afterGap = halfHourPlayoutEntry("entry_gap", 3);

    expect(selectedIds(following([first, afterGap], 3))).toEqual(["entry_1"]);
  });

  it("stops at an unplayable candidate without skipping past it", () => {
    const missing = halfHourPlayoutEntry("entry_missing", 2, {
      status: "missing",
    });

    expect(selectedIds(following([first, missing, third], 3))).toEqual([
      "entry_1",
    ]);
  });

  it("selects nothing when the first candidate does not start at the cursor's end", () => {
    expect(selectedIds(following([second, third], 2))).toEqual([]);
  });

  it("selects nothing when the first candidate is unplayable", () => {
    const noDuration = halfHourPlayoutEntry("entry_unprobed", 1, {
      durationMs: null,
    });

    expect(selectedIds(following([noDuration, second], 2))).toEqual([]);
  });

  it("selects nothing from no candidates", () => {
    expect(selectedIds(following([], 2))).toEqual([]);
  });

  it("still selects an item whose media is shorter than its airtime", () => {
    const short = halfHourPlayoutEntry("entry_short", 1, {
      durationMs: 10 * MINUTE_MS,
    });

    expect(selectedIds(following([short, second], 2))).toEqual([
      "entry_short",
      "entry_2",
    ]);
  });

  it("judges contiguity from the cursor's end whatever the cursor's media", () => {
    const unplayableCursor = halfHourPlayoutEntry("entry_cursor", 0, {
      status: "probe_failed",
    });

    expect(selectedIds(following([first], 1, unplayableCursor))).toEqual([
      "entry_1",
    ]);
  });

  it("returns stale_entry with no items when the cursor no longer exists", () => {
    const result = selectFollowingPlayout({
      channelId: CHANNEL_ID,
      scheduleRevision: SCHEDULE_REVISION,
      cursor: undefined,
      candidates: [first, second],
      count: 2,
    });

    expect(result).toEqual({
      status: "stale_entry",
      channelId: CHANNEL_ID,
      scheduleRevision: SCHEDULE_REVISION,
      items: [],
    });
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects count %s", (count) => {
    expect(() => following([first], count)).toThrow(/count/);
  });
});
