// Programming assignment request bodies for route and acceptance tests only; production code must never import this module.
import type { PlaybackMode } from "@krazitv/krazi-brain";

/** The body that assigns one collection in a mode, three programs a turn, as the editor saves it. */
export function collectionAssignment(
  mediaCollectionId: string,
  playbackMode: PlaybackMode = "chronological",
) {
  return {
    playbackMode,
    ordinaryStretch: { kind: "programs", count: 3 },
    marathonStretch: null,
    members: [{ kind: "collection", mediaCollectionId }],
  };
}

/** The body that assigns one media item, which airs once each turn. */
export function itemAssignment(mediaItemId: string) {
  return {
    playbackMode: null,
    ordinaryStretch: { kind: "programs", count: 1 },
    marathonStretch: null,
    members: [{ kind: "media_item", mediaItemId }],
  };
}
