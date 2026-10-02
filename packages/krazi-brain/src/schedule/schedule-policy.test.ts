import { describe, expect, it } from "vitest";

import { scheduleMedia } from "../testing/schedule-media.js";
import type { ScheduleMedia, ScheduleSource } from "./contracts.js";
import {
  findUnschedulableReason,
  isSchedulableMedia,
  MIN_SCHEDULABLE_DURATION_MS,
  SCHEDULE_HORIZON_MS,
} from "./schedule-policy.js";

function collectionOf(members: ScheduleMedia[]): ScheduleSource {
  return {
    kind: "collection",
    programmingBlockId: "block-1",
    mediaCollectionId: "collection-1",
    playbackMode: "chronological",
    members,
  };
}

describe("schedule policy constants", () => {
  it("keeps 72 hours of schedule ahead of now", () => {
    expect(SCHEDULE_HORIZON_MS).toBe(72 * 60 * 60 * 1000);
  });

  it("sets the duration floor at one second", () => {
    expect(MIN_SCHEDULABLE_DURATION_MS).toBe(1000);
  });
});

describe("isSchedulableMedia", () => {
  it("accepts available media at the duration floor", () => {
    expect(isSchedulableMedia(scheduleMedia("a", { durationMs: 1000 }))).toBe(
      true,
    );
  });

  it.each([
    ["missing", { status: "missing" }],
    ["probe_failed", { status: "probe_failed" }],
    ["a null duration", { durationMs: null }],
    ["a duration under the floor", { durationMs: 999 }],
    ["a fractional duration", { durationMs: 1500.5 }],
    ["a zero duration", { durationMs: 0 }],
  ] as const)("rejects media with %s", (_label, overrides) => {
    expect(isSchedulableMedia(scheduleMedia("a", overrides))).toBe(false);
  });
});

describe("findUnschedulableReason", () => {
  it("reports an empty collection", () => {
    expect(findUnschedulableReason(collectionOf([]))).toBe("empty_collection");
  });

  it("reports a collection with no schedulable member", () => {
    const members = [
      scheduleMedia("a", { status: "missing" }),
      scheduleMedia("b", { durationMs: null }),
    ];
    expect(findUnschedulableReason(collectionOf(members))).toBe(
      "no_schedulable_members",
    );
  });

  it("accepts a collection with one schedulable member", () => {
    const members = [
      scheduleMedia("a", { status: "missing" }),
      scheduleMedia("b"),
    ];
    expect(findUnschedulableReason(collectionOf(members))).toBeNull();
  });

  it("reports an unschedulable single media item", () => {
    const source: ScheduleSource = {
      kind: "media_item",
      programmingBlockId: "block-1",
      media: scheduleMedia("a", { status: "probe_failed" }),
    };
    expect(findUnschedulableReason(source)).toBe("media_item_unschedulable");
  });

  it("accepts a schedulable single media item", () => {
    const source: ScheduleSource = {
      kind: "media_item",
      programmingBlockId: "block-1",
      media: scheduleMedia("a"),
    };
    expect(findUnschedulableReason(source)).toBeNull();
  });
});
