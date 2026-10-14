import { describe, expect, it } from "vitest";

import {
  NO_PROGRESS,
  type PlaybackMode,
  type RestorableEntry,
} from "./contracts.js";
import {
  findRegenerationBoundary,
  restorePlaybackProgress,
} from "./regeneration.js";

const NOW = 1_767_225_600_000;

// An entry's collection bookkeeping; the sequence number orders entries.
function entry(
  sequenceNumber: number,
  playbackMode: PlaybackMode,
  playbackIndex: number,
  mediaItemId = `item-${playbackIndex}`,
  mediaCollectionId: string | null = "collection-1",
): RestorableEntry {
  return {
    sequenceNumber,
    mediaItemId,
    mediaCollectionId,
    playbackMode,
    playbackIndex,
  };
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
  it("returns ordered progress to the latest kept entry of its collection and mode", () => {
    const restored = restorePlaybackProgress(
      [entry(12, "chronological", 3), entry(13, "chronological", 0)],
      [
        entry(9, "chronological", 1, "b"),
        entry(11, "chronological", 2, "c"),
        entry(10, "chronological", 0, "a"),
      ],
    );

    expect(restored).toEqual([
      {
        mediaCollectionId: "collection-1",
        playbackMode: "chronological",
        progress: { ...NO_PROGRESS, lastMediaItemId: "c", lastPosition: 2 },
      },
    ]);
  });

  it("ignores kept entries of another collection or mode", () => {
    const restored = restorePlaybackProgress(
      [entry(12, "chronological", 3)],
      [
        entry(9, "chronological", 1, "b"),
        entry(10, "random", 4, "x"),
        entry(11, "chronological", 2, "y", "collection-2"),
      ],
    );

    expect(restored).toEqual([
      {
        mediaCollectionId: "collection-1",
        playbackMode: "chronological",
        progress: { ...NO_PROGRESS, lastMediaItemId: "b", lastPosition: 1 },
      },
    ]);
  });

  it("returns ordered progress to the beginning when no entry of it was kept", () => {
    const restored = restorePlaybackProgress(
      [entry(0, "chronological", 0), entry(1, "chronological", 1)],
      [],
    );

    expect(restored).toEqual([
      {
        mediaCollectionId: "collection-1",
        playbackMode: "chronological",
        progress: NO_PROGRESS,
      },
    ]);
  });

  it("rewinds random progress to the earliest deleted entry's selection index", () => {
    const restored = restorePlaybackProgress(
      [entry(6, "random", 7), entry(5, "random", 6)],
      [entry(4, "random", 5)],
    );

    expect(restored).toEqual([
      {
        mediaCollectionId: "collection-1",
        playbackMode: "random",
        progress: { ...NO_PROGRESS, nextSelectionIndex: 6 },
      },
    ]);
  });

  it("restores each collection and mode separately", () => {
    const restored = restorePlaybackProgress(
      [
        entry(20, "random", 7),
        entry(21, "chronological", 1),
        entry(22, "chronological", 4, "item-4", "collection-2"),
      ],
      [
        entry(18, "chronological", 0, "a"),
        entry(19, "chronological", 3, "d", "collection-2"),
      ],
    );

    expect(restored).toEqual([
      {
        mediaCollectionId: "collection-1",
        playbackMode: "random",
        progress: { ...NO_PROGRESS, nextSelectionIndex: 7 },
      },
      {
        mediaCollectionId: "collection-1",
        playbackMode: "chronological",
        progress: { ...NO_PROGRESS, lastMediaItemId: "a", lastPosition: 0 },
      },
      {
        mediaCollectionId: "collection-2",
        playbackMode: "chronological",
        progress: { ...NO_PROGRESS, lastMediaItemId: "d", lastPosition: 3 },
      },
    ]);
  });

  it("restores nothing for entries without collection bookkeeping", () => {
    const restored = restorePlaybackProgress(
      [
        {
          sequenceNumber: 1,
          mediaItemId: "item-1",
          mediaCollectionId: null,
          playbackMode: null,
          playbackIndex: null,
        },
        // Its collection was deleted, so there is no progress left to restore.
        entry(2, "chronological", 0, "item-0", null),
      ],
      [],
    );

    expect(restored).toEqual([]);
  });
});

describe("restorePlaybackProgress after a progress reset", () => {
  // The reset recorded that entries from sequence number 20 on follow it.
  const reset = {
    mediaCollectionId: "collection-1",
    playbackMode: "chronological",
    resetSequenceNumber: 20,
  } as const;

  it("never returns ordered progress to an entry kept from before the reset", () => {
    const restored = restorePlaybackProgress(
      [entry(20, "chronological", 0), entry(21, "chronological", 1)],
      [entry(19, "chronological", 4, "airing")],
      [reset],
    );

    expect(restored).toEqual([
      {
        mediaCollectionId: "collection-1",
        playbackMode: "chronological",
        progress: NO_PROGRESS,
      },
    ]);
  });

  it("restores from entries generated after the reset", () => {
    const restored = restorePlaybackProgress(
      [entry(23, "chronological", 3)],
      [
        entry(19, "chronological", 4, "airing"),
        entry(22, "chronological", 2, "c"),
      ],
      [reset],
    );

    expect(restored).toEqual([
      {
        mediaCollectionId: "collection-1",
        playbackMode: "chronological",
        progress: { ...NO_PROGRESS, lastMediaItemId: "c", lastPosition: 2 },
      },
    ]);
  });

  it("leaves reset random progress alone when every deleted entry predates the reset", () => {
    const restored = restorePlaybackProgress(
      [entry(18, "random", 40), entry(19, "random", 41)],
      [],
      [{ ...reset, playbackMode: "random" }],
    );

    expect(restored).toEqual([]);
  });

  it("applies a reset only to its own collection and mode", () => {
    const restored = restorePlaybackProgress(
      [entry(18, "random", 40)],
      [],
      [reset],
    );

    expect(restored).toEqual([
      {
        mediaCollectionId: "collection-1",
        playbackMode: "random",
        progress: { ...NO_PROGRESS, nextSelectionIndex: 40 },
      },
    ]);
  });
});
