import type {
  GeneratedScheduleEntry,
  GenerationResult,
  PlaybackMode,
  PlaybackProgress,
  ScheduleMedia,
  ScheduleSource,
} from "./contracts.js";
import { selectChronological } from "./playback-selection.js";
import { findUnschedulableReason } from "./schedule-policy.js";

interface GenerateScheduleEntriesOptions {
  /** The channel's persisted seed; random playback derives from it. */
  channelSeed: number;
  source: ScheduleSource;
  /** The channel's progress through the source collection. */
  progress: PlaybackProgress;
  startsAt: number;
  /** No entry starts at or after this instant; the last one may end past it. */
  through: number;
  nextSequenceNumber: number;
  /** Caps one call so a caller can persist long horizons in bounded chunks. */
  maxEntries: number;
}

/** What one entry airs and the collection bookkeeping it carries. */
interface NextAiring {
  media: ScheduleMedia;
  mediaCollectionId: string | null;
  playbackMode: PlaybackMode | null;
  playbackIndex: number | null;
  progress: PlaybackProgress;
}

/**
 * Chooses what airs next from a source and advances progress past it. A
 * single item repeats and leaves progress untouched, because only collections
 * carry playback progress.
 */
function nextAiring(
  source: ScheduleSource,
  progress: PlaybackProgress,
): NextAiring {
  if (source.kind === "media_item") {
    return {
      media: source.media,
      mediaCollectionId: null,
      playbackMode: null,
      playbackIndex: null,
      progress,
    };
  }
  if (source.playbackMode === "random") {
    throw new Error("random playback is not implemented yet");
  }
  const selection = selectChronological(
    source.members,
    progress.nextChronologicalPosition,
  );
  return {
    media: selection.media,
    mediaCollectionId: source.mediaCollectionId,
    playbackMode: "chronological",
    playbackIndex: selection.playbackIndex,
    progress: { ...progress, nextChronologicalPosition: selection.nextIndex },
  };
}

/**
 * Generates contiguous schedule entries from `startsAt` until one ends at or
 * past `through` or `maxEntries` is reached, without touching persistence.
 * The result carries everything needed to resume exactly where it stopped, so
 * chunked calls produce the same entries as one long call. The output depends
 * only on the inputs.
 */
export function generateScheduleEntries(
  options: GenerateScheduleEntriesOptions,
): GenerationResult {
  const { source, through, maxEntries } = options;
  const reason = findUnschedulableReason(source);
  if (reason !== null) {
    return { kind: "unschedulable", reason };
  }

  const entries: GeneratedScheduleEntry[] = [];
  let cursor = options.startsAt;
  let progress = options.progress;
  let sequenceNumber = options.nextSequenceNumber;
  while (cursor < through && entries.length < maxEntries) {
    const airing = nextAiring(source, progress);
    // The schedulability check guarantees an integer duration at the floor.
    const durationMs = airing.media.durationMs ?? 0;
    entries.push({
      mediaItemId: airing.media.id,
      title: airing.media.title,
      startsAt: cursor,
      endsAt: cursor + durationMs,
      durationMs,
      sequenceNumber,
      programmingBlockId: source.programmingBlockId,
      mediaCollectionId: airing.mediaCollectionId,
      playbackMode: airing.playbackMode,
      playbackIndex: airing.playbackIndex,
    });
    cursor += durationMs;
    sequenceNumber += 1;
    progress = airing.progress;
  }

  return {
    kind: "generated",
    entries,
    progress,
    nextSequenceNumber: sequenceNumber,
    generatedThrough: cursor,
  };
}
