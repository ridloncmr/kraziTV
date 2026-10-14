import {
  NO_PROGRESS,
  type PlaybackMode,
  type PlaybackProgress,
  type RestorableEntry,
  type RestoredProgress,
} from "./contracts.js";

/**
 * Returns the instant regeneration rebuilds from: the end of the entry airing
 * at the effective current time, so viewers never see it change, or that time
 * itself when nothing airs.
 */
export function findRegenerationBoundary(
  airingEntry: { endsAt: number } | undefined,
  effectiveNow: number,
): number {
  return airingEntry?.endsAt ?? effectiveNow;
}

/**
 * Returns the progress each collection and mode the deleted entries drew
 * from goes back to, so regenerated entries continue where the kept schedule
 * ends and a collection or mode the deletion never touched keeps its place.
 * An ordered mode resumes after its latest kept entry, or from the beginning
 * when none was kept; random rewinds to its earliest deleted selection index.
 * Results follow each one's earliest deleted entry. Entries without a
 * collection (single items, or a deleted collection) carry nothing to
 * restore.
 */
export function restorePlaybackProgress(
  deletedEntries: readonly RestorableEntry[],
  keptEntries: readonly RestorableEntry[],
): RestoredProgress[] {
  const earliestFirst = [...deletedEntries].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber,
  );
  const restored = new Map<string, RestoredProgress>();
  for (const entry of earliestFirst) {
    const { mediaCollectionId, playbackMode, playbackIndex } = entry;
    if (
      mediaCollectionId === null ||
      playbackMode === null ||
      playbackIndex === null
    ) {
      continue;
    }
    const key = JSON.stringify([mediaCollectionId, playbackMode]);
    if (restored.has(key)) continue;
    restored.set(key, {
      mediaCollectionId,
      playbackMode,
      progress:
        playbackMode === "random"
          ? { ...NO_PROGRESS, nextSelectionIndex: playbackIndex }
          : progressAfter(
              latestEntry(keptEntries, mediaCollectionId, playbackMode),
            ),
    });
  }
  return [...restored.values()];
}

/** Returns the latest entry of one collection and mode, if there is one. */
function latestEntry(
  entries: readonly RestorableEntry[],
  mediaCollectionId: string,
  playbackMode: PlaybackMode,
): RestorableEntry | undefined {
  let latest: RestorableEntry | undefined;
  for (const entry of entries) {
    if (
      entry.mediaCollectionId === mediaCollectionId &&
      entry.playbackMode === playbackMode &&
      (latest === undefined || entry.sequenceNumber > latest.sequenceNumber)
    ) {
      latest = entry;
    }
  }
  return latest;
}

/** Returns ordered progress that resumes after `entry`, or from the start without one. */
function progressAfter(entry: RestorableEntry | undefined): PlaybackProgress {
  return entry === undefined
    ? NO_PROGRESS
    : {
        ...NO_PROGRESS,
        lastMediaItemId: entry.mediaItemId,
        lastPosition: entry.playbackIndex,
      };
}
