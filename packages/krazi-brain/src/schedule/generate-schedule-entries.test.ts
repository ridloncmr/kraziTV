import { describe, expect, it } from "vitest";

import { scheduleMedia } from "../testing/schedule-media.js";
import type {
  GeneratedScheduleEntry,
  GenerationResult,
  PlaybackProgress,
  ScheduleMedia,
  ScheduleSource,
} from "./contracts.js";
import { generateScheduleEntries } from "./generate-schedule-entries.js";
import { SCHEDULE_HORIZON_MS } from "./schedule-policy.js";

// 2026-01-01T00:00:00.000Z as a UTC millisecond schedule anchor.
const STARTS_AT = 1_767_225_600_000;
const HOUR_MS = 60 * 60 * 1000;
const START_PROGRESS: PlaybackProgress = {
  nextChronologicalPosition: 0,
  nextRandomSelectionIndex: 0,
};

function chronological(members: ScheduleMedia[]): ScheduleSource {
  return {
    kind: "collection",
    programmingBlockId: "block-1",
    mediaCollectionId: "collection-1",
    playbackMode: "chronological",
    members,
  };
}

function singleItem(media: ScheduleMedia): ScheduleSource {
  return { kind: "media_item", programmingBlockId: "block-1", media };
}

interface GenerateOverrides {
  progress?: PlaybackProgress;
  startsAt?: number;
  through?: number;
  nextSequenceNumber?: number;
  maxEntries?: number;
}

function generate(
  source: ScheduleSource,
  overrides: GenerateOverrides = {},
): GenerationResult {
  return generateScheduleEntries({
    channelSeed: 0x5d4886b3,
    source,
    progress: START_PROGRESS,
    startsAt: STARTS_AT,
    through: STARTS_AT + HOUR_MS,
    nextSequenceNumber: 0,
    maxEntries: 500,
    ...overrides,
  });
}

/** Narrows a result to `generated`, failing the test with its reason otherwise. */
function generated(result: GenerationResult) {
  if (result.kind !== "generated") {
    throw new Error(`expected generated, got unschedulable: ${result.reason}`);
  }
  return result;
}

function mediaIds(entries: GeneratedScheduleEntry[]): string[] {
  return entries.map((entry) => entry.mediaItemId);
}

describe("generateScheduleEntries: chronological collections", () => {
  it("follows membership order, not title or path order", () => {
    const members = [
      scheduleMedia("c", { title: "Zebra" }),
      scheduleMedia("a", { title: "Apple" }),
      scheduleMedia("b", { title: "Mango" }),
    ];

    const result = generated(
      generate(chronological(members), { through: STARTS_AT + 3 * 60_000 }),
    );

    expect(mediaIds(result.entries)).toEqual(["c", "a", "b"]);
  });

  it("records the collection, mode, and position each entry consumed", () => {
    const members = [scheduleMedia("a"), scheduleMedia("b")];

    const result = generated(
      generate(chronological(members), { through: STARTS_AT + 2 * 60_000 }),
    );

    expect(result.entries[1]).toEqual({
      mediaItemId: "b",
      title: "Title b",
      startsAt: STARTS_AT + 60_000,
      endsAt: STARTS_AT + 120_000,
      durationMs: 60_000,
      sequenceNumber: 1,
      programmingBlockId: "block-1",
      mediaCollectionId: "collection-1",
      playbackMode: "chronological",
      playbackIndex: 1,
    });
  });

  it("wraps around to the first member and advances progress modulo the count", () => {
    const members = [
      scheduleMedia("a"),
      scheduleMedia("b"),
      scheduleMedia("c"),
    ];

    const result = generated(
      generate(chronological(members), {
        progress: { nextChronologicalPosition: 2, nextRandomSelectionIndex: 7 },
        through: STARTS_AT + 4 * 60_000,
      }),
    );

    expect(mediaIds(result.entries)).toEqual(["c", "a", "b", "c"]);
    expect(result.entries.map((entry) => entry.playbackIndex)).toEqual([
      2, 0, 1, 2,
    ]);
    expect(result.progress).toEqual({
      nextChronologicalPosition: 0,
      nextRandomSelectionIndex: 7,
    });
  });

  it("takes a stored position modulo a collection that has shrunk", () => {
    const members = [scheduleMedia("a"), scheduleMedia("b")];

    const result = generated(
      generate(chronological(members), {
        progress: { nextChronologicalPosition: 5, nextRandomSelectionIndex: 0 },
        through: STARTS_AT + 60_000,
      }),
    );

    expect(result.entries[0]?.mediaItemId).toBe("b");
    expect(result.entries[0]?.playbackIndex).toBe(1);
  });

  it.each([
    ["missing", { status: "missing" }],
    ["probe_failed", { status: "probe_failed" }],
    ["a null duration", { durationMs: null }],
    ["a duration under the floor", { durationMs: 999 }],
  ] as const)(
    "skips a member with %s and still consumes its position",
    (_label, overrides) => {
      const members = [
        scheduleMedia("a"),
        scheduleMedia("skipped", overrides),
        scheduleMedia("c"),
      ];

      const result = generated(
        generate(chronological(members), { through: STARTS_AT + 3 * 60_000 }),
      );

      expect(mediaIds(result.entries)).toEqual(["a", "c", "a"]);
      expect(result.entries.map((entry) => entry.playbackIndex)).toEqual([
        0, 2, 0,
      ]);
      expect(result.progress.nextChronologicalPosition).toBe(1);
    },
  );

  it("returns unschedulable for an empty collection", () => {
    expect(generate(chronological([]))).toEqual({
      kind: "unschedulable",
      reason: "empty_collection",
    });
  });

  it("returns unschedulable for an all-unschedulable collection", () => {
    const members = [
      scheduleMedia("a", { status: "missing" }),
      scheduleMedia("b", { durationMs: 10 }),
    ];

    expect(generate(chronological(members))).toEqual({
      kind: "unschedulable",
      reason: "no_schedulable_members",
    });
  });

  it("terminates with one schedulable member among 1,000 unschedulable ones", () => {
    const members = Array.from({ length: 1000 }, (_, index) =>
      scheduleMedia(`missing-${index}`, { status: "missing" }),
    );
    members.splice(600, 0, scheduleMedia("only"));

    const result = generated(
      generate(chronological(members), { through: STARTS_AT + 3 * 60_000 }),
    );

    expect(mediaIds(result.entries)).toEqual(["only", "only", "only"]);
    expect(result.progress.nextChronologicalPosition).toBe(601);
  });
});

describe("generateScheduleEntries: single media items", () => {
  it("loops one item and passes progress through unchanged", () => {
    const progress = {
      nextChronologicalPosition: 4,
      nextRandomSelectionIndex: 9,
    };

    const result = generated(
      generate(singleItem(scheduleMedia("a", { durationMs: 20 * 60_000 })), {
        progress,
      }),
    );

    expect(mediaIds(result.entries)).toEqual(["a", "a", "a"]);
    expect(result.progress).toEqual(progress);
  });

  it("leaves collection fields null", () => {
    const result = generated(generate(singleItem(scheduleMedia("a"))));

    expect(result.entries[0]).toMatchObject({
      programmingBlockId: "block-1",
      mediaCollectionId: null,
      playbackMode: null,
      playbackIndex: null,
    });
  });

  it("returns unschedulable for an unschedulable item", () => {
    expect(
      generate(singleItem(scheduleMedia("a", { status: "missing" }))),
    ).toEqual({ kind: "unschedulable", reason: "media_item_unschedulable" });
  });
});

describe("generateScheduleEntries: bounds and timing", () => {
  it("produces contiguous integer times and consecutive sequence numbers", () => {
    const members = [
      scheduleMedia("a", { durationMs: 1_320_123 }),
      scheduleMedia("b", { durationMs: 2_700_001 }),
    ];

    const result = generated(
      generate(chronological(members), {
        nextSequenceNumber: 41,
        through: STARTS_AT + 6 * HOUR_MS,
      }),
    );

    expect(result.entries[0]?.startsAt).toBe(STARTS_AT);
    result.entries.forEach((entry, index) => {
      expect(Number.isInteger(entry.startsAt)).toBe(true);
      expect(entry.endsAt - entry.startsAt).toBe(entry.durationMs);
      expect(entry.sequenceNumber).toBe(41 + index);
      if (index > 0) {
        expect(entry.startsAt).toBe(result.entries[index - 1]?.endsAt);
      }
    });
    expect(result.nextSequenceNumber).toBe(41 + result.entries.length);
    expect(result.generatedThrough).toBe(result.entries.at(-1)?.endsAt);
  });

  it("lets the last entry overrun through, and starts no entry at or past it", () => {
    const result = generated(
      generate(singleItem(scheduleMedia("a", { durationMs: 25 * 60_000 })), {
        through: STARTS_AT + HOUR_MS,
      }),
    );

    expect(result.entries).toHaveLength(3);
    expect(result.generatedThrough).toBe(STARTS_AT + 75 * 60_000);
  });

  it("generates nothing when the window is already covered", () => {
    const result = generated(
      generate(chronological([scheduleMedia("a")]), {
        progress: { nextChronologicalPosition: 3, nextRandomSelectionIndex: 0 },
        nextSequenceNumber: 12,
        through: STARTS_AT,
      }),
    );

    expect(result).toEqual({
      kind: "generated",
      entries: [],
      progress: { nextChronologicalPosition: 3, nextRandomSelectionIndex: 0 },
      nextSequenceNumber: 12,
      generatedThrough: STARTS_AT,
    });
  });

  it("stops at maxEntries for a floor-length item over 72 hours and resumes exactly", () => {
    const source = singleItem(scheduleMedia("a", { durationMs: 1000 }));
    const through = STARTS_AT + SCHEDULE_HORIZON_MS;

    const first = generated(generate(source, { through, maxEntries: 500 }));
    const second = generated(
      generate(source, {
        progress: first.progress,
        startsAt: first.generatedThrough,
        nextSequenceNumber: first.nextSequenceNumber,
        through,
        maxEntries: 500,
      }),
    );
    const whole = generated(generate(source, { through, maxEntries: 1000 }));

    expect(first.entries).toHaveLength(500);
    expect(first.generatedThrough).toBe(STARTS_AT + 500 * 1000);
    expect([...first.entries, ...second.entries]).toEqual(whole.entries);
    expect(second.generatedThrough).toBe(whole.generatedThrough);
  });

  it("resumes a chronological collection exactly across chunks", () => {
    const source = chronological([
      scheduleMedia("a"),
      scheduleMedia("gone", { status: "missing" }),
      scheduleMedia("c"),
      scheduleMedia("d"),
    ]);
    const through = STARTS_AT + 2 * HOUR_MS;

    const first = generated(generate(source, { through, maxEntries: 7 }));
    const second = generated(
      generate(source, {
        progress: first.progress,
        startsAt: first.generatedThrough,
        nextSequenceNumber: first.nextSequenceNumber,
        through,
      }),
    );
    const whole = generated(generate(source, { through }));

    expect([...first.entries, ...second.entries]).toEqual(whole.entries);
    expect(second.progress).toEqual(whole.progress);
  });

  it("returns the same output for the same input", () => {
    const source = chronological([
      scheduleMedia("a", { durationMs: 1_800_000 }),
      scheduleMedia("b", { status: "probe_failed" }),
      scheduleMedia("c", { durationMs: 2_400_000 }),
    ]);
    const options = {
      progress: { nextChronologicalPosition: 1, nextRandomSelectionIndex: 0 },
      through: STARTS_AT + 24 * HOUR_MS,
    };

    expect(generate(source, options)).toEqual(generate(source, options));
  });
});
