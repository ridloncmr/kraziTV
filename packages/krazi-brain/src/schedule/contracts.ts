/**
 * Every way a collection-sourced block can order its collection. The one
 * list of values: the server's request validation and persisted columns
 * derive from it, so a new mode cannot be accepted before it is scheduled.
 */
export const PLAYBACK_MODES = ["chronological", "random"] as const;

/** How a collection-sourced block orders its collection. */
export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

/** A media item's catalog status. */
export type ScheduleMediaStatus = "available" | "missing" | "probe_failed";

/** The catalog facts about one media item that scheduling needs. */
export interface ScheduleMedia {
  id: string;
  title: string;
  status: ScheduleMediaStatus;
  durationMs: number | null;
}

/** A programming block's source, with its media resolved from the catalog. */
export type ScheduleSource =
  | {
      kind: "collection";
      programmingBlockId: string;
      mediaCollectionId: string;
      playbackMode: PlaybackMode;
      /** Collection members in explicit membership order. */
      members: readonly ScheduleMedia[];
    }
  | {
      kind: "media_item";
      programmingBlockId: string;
      media: ScheduleMedia;
    };

/** How far a channel has advanced through one media collection. */
export interface PlaybackProgress {
  nextChronologicalPosition: number;
  nextRandomSelectionIndex: number;
}

/** Why a source cannot produce any schedule entry. */
export type UnschedulableReason =
  "empty_collection" | "no_schedulable_members" | "media_item_unschedulable";

/** One schedule entry before persistence assigns its ID and channel. */
export interface GeneratedScheduleEntry {
  mediaItemId: string;
  title: string;
  startsAt: number;
  endsAt: number;
  durationMs: number;
  sequenceNumber: number;
  programmingBlockId: string;
  mediaCollectionId: string | null;
  playbackMode: PlaybackMode | null;
  playbackIndex: number | null;
}

/** The collection bookkeeping of an entry regeneration deleted. */
export type RestorableEntry = Pick<
  GeneratedScheduleEntry,
  "sequenceNumber" | "mediaCollectionId" | "playbackMode" | "playbackIndex"
>;

export type GenerationResult =
  | { kind: "unschedulable"; reason: UnschedulableReason }
  | {
      kind: "generated";
      entries: GeneratedScheduleEntry[];
      progress: PlaybackProgress;
      nextSequenceNumber: number;
      /** The end of the last entry, or `startsAt` when none was generated. */
      generatedThrough: number;
    };
