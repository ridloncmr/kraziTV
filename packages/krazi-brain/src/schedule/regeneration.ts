import type { PlaybackProgress, RestorableEntry } from "./contracts.js";

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
 * Rewinds each collection's progress to where its earliest deleted entry
 * picked up, separately per playback mode, so regenerated entries continue
 * exactly where the kept schedule ends and a mode the deletion never touched
 * keeps its place. Returns only the collections it changed. Entries without
 * a collection (single items, or a deleted collection) carry nothing to
 * restore.
 */
export function restorePlaybackProgress(
  currentProgressByCollection: ReadonlyMap<string, PlaybackProgress>,
  deletedEntries: readonly RestorableEntry[],
): Map<string, PlaybackProgress> {
  const latestFirst = [...deletedEntries].sort(
    (a, b) => b.sequenceNumber - a.sequenceNumber,
  );
  const restored = new Map<string, PlaybackProgress>();
  // Walking latest to earliest lets each earlier entry overwrite a later one.
  for (const entry of latestFirst) {
    const { mediaCollectionId, playbackMode, playbackIndex } = entry;
    if (mediaCollectionId === null || playbackIndex === null) continue;
    const progress =
      restored.get(mediaCollectionId) ??
      currentProgressByCollection.get(mediaCollectionId);
    if (progress === undefined) {
      throw new Error(
        `No current progress for collection ${mediaCollectionId} to restore`,
      );
    }
    restored.set(
      mediaCollectionId,
      playbackMode === "random"
        ? { ...progress, nextRandomSelectionIndex: playbackIndex }
        : { ...progress, nextChronologicalPosition: playbackIndex },
    );
  }
  return restored;
}
