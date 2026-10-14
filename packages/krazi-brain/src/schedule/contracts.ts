/**
 * Every way a collection-sourced block can order its collection. The one
 * list of values: the server's request validation and persisted columns
 * derive from it, so a new mode cannot be accepted before it is scheduled.
 */
export const PLAYBACK_MODES = ["chronological", "episode", "random"] as const;

/** How a collection-sourced block orders its collection. */
export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

/** A media item's catalog status. */
export type ScheduleMediaStatus = "available" | "missing" | "probe_failed";

/**
 * The catalog facts about one media item that scheduling needs. The
 * ordering facts are effective content metadata, with the owner's
 * corrections already applied; each is null when unknown, and always null
 * for an extra.
 */
export interface ScheduleMedia {
  id: string;
  title: string;
  status: ScheduleMediaStatus;
  durationMs: number | null;
  /** Null when the series is unknown or the owner renamed it away from TMDB's. */
  seriesTmdbId: number | null;
  seriesName: string | null;
  seasonNumber: number | null;
  /** The first episode a multi-episode file holds. */
  episodeNumber: number | null;
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

/**
 * How far a channel has advanced through one media collection in one
 * playback mode. Ordered modes use only the last selection; random uses only
 * the selection index. A field the mode does not use stays at its
 * `NO_PROGRESS` value.
 */
export interface PlaybackProgress {
  /** Ordered modes: the last media item selected, or null before the first. */
  lastMediaItemId: string | null;
  /** Ordered modes: the ordered position that item held, or null before the first. */
  lastPosition: number | null;
  /** Random: the selection index the next pick consumes. */
  nextSelectionIndex: number;
}

/** Progress through a collection a channel has never played in a mode. */
export const NO_PROGRESS: PlaybackProgress = Object.freeze({
  lastMediaItemId: null,
  lastPosition: null,
  nextSelectionIndex: 0,
});

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

/**
 * The collection bookkeeping of an entry regeneration deleted or kept: what
 * it selected, and the collection, mode, and position or index it consumed.
 */
export type RestorableEntry = Pick<
  GeneratedScheduleEntry,
  | "sequenceNumber"
  | "mediaItemId"
  | "mediaCollectionId"
  | "playbackMode"
  | "playbackIndex"
>;

/** The progress one collection and mode returns to after regeneration. */
export interface RestoredProgress {
  mediaCollectionId: string;
  playbackMode: PlaybackMode;
  progress: PlaybackProgress;
}

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
