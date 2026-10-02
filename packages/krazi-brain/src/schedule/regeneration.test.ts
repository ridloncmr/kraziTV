import { describe, expect, it } from "vitest";

import type { PlaybackProgress, RestorableEntry } from "./contracts.js";
import {
  findRegenerationBoundary,
  restorePlaybackProgress,
} from "./regeneration.js";

const NOW = 1_767_225_600_000;

// A deleted collection entry; the sequence number orders deletions.
function deleted(
  sequenceNumber: number,
  playbackMode: "chronological" | "random",
  playbackIndex: number,
  mediaCollectionId: string | null = "collection-1",
): RestorableEntry {
  return { sequenceNumber, mediaCollectionId, playbackMode, playbackIndex };
}

function progress(
  nextChronologicalPosition: number,
  nextRandomSelectionIndex: number,
): PlaybackProgress {
  return { nextChronologicalPosition, nextRandomSelectionIndex };
}

describe("findRegenerationBoundary", () => {
  it("keeps the airing entry by starting at its end", () => {
    expect(findRegenerationBoundary({ endsAt: NOW + 1_000 }, NOW)).toBe(
      NOW + 1_000,
    );
  });

  it("starts at the effective current time when nothing is airing", () => {
    expect(findRegenerationBoundary(undefined, NOW)).toBe(NOW);
  });
});

describe("restorePlaybackProgress", () => {
  it("rewinds chronological progress to the earliest deleted entry's position", () => {
    const current = new Map([["collection-1", progress(2, 7)]]);

    const restored = restorePlaybackProgress(current, [
      deleted(11, "chronological", 0),
      deleted(10, "chronological", 3),
      deleted(12, "chronological", 1),
    ]);

    expect(restored).toEqual(new Map([["collection-1", progress(3, 7)]]));
  });

  it("rewinds random progress to the earliest deleted entry's selection index", () => {
    const current = new Map([["collection-1", progress(2, 9)]]);

    const restored = restorePlaybackProgress(current, [
      deleted(5, "random", 6),
      deleted(6, "random", 7),
    ]);

    expect(restored).toEqual(new Map([["collection-1", progress(2, 6)]]));
  });

  it("restores each playback mode from its own earliest entry", () => {
    const current = new Map([["collection-1", progress(4, 9)]]);

    const restored = restorePlaybackProgress(current, [
      deleted(20, "random", 7),
      deleted(21, "random", 8),
      deleted(22, "chronological", 1),
    ]);

    expect(restored).toEqual(new Map([["collection-1", progress(1, 7)]]));
  });

  it("restores each collection independently", () => {
    const current = new Map([
      ["collection-1", progress(5, 0)],
      ["collection-2", progress(0, 4)],
    ]);

    const restored = restorePlaybackProgress(current, [
      deleted(1, "chronological", 2, "collection-1"),
      deleted(2, "random", 3, "collection-2"),
    ]);

    expect(restored).toEqual(
      new Map([
        ["collection-1", progress(2, 0)],
        ["collection-2", progress(0, 3)],
      ]),
    );
  });

  it("leaves progress alone for entries without collection bookkeeping", () => {
    const current = new Map([["collection-1", progress(2, 3)]]);

    const restored = restorePlaybackProgress(current, [
      {
        sequenceNumber: 1,
        mediaCollectionId: null,
        playbackMode: null,
        playbackIndex: null,
      },
      // Its collection was deleted, so there is no progress left to restore.
      deleted(2, "chronological", 0, null),
    ]);

    expect(restored).toEqual(new Map());
  });

  it("refuses a deleted entry whose collection has no current progress", () => {
    expect(() =>
      restorePlaybackProgress(new Map(), [deleted(1, "chronological", 0)]),
    ).toThrow(/collection-1/);
  });
});
