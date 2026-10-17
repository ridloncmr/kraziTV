import type {
  GeneratedScheduleEntry,
  GenerationResult,
  PlaybackMode,
  PlaybackProgress,
  ScheduleMedia,
  ScheduleSource,
  TurnSize,
} from "./contracts.js";
import { orderMembers } from "./ordered-view.js";
import { selectOrdered, selectRandom } from "./playback-selection.js";
import { findUnschedulableReason, fitsBefore } from "./schedule-policy.js";
import { deriveCollectionSeed } from "./seeded-hash.js";

interface GenerateScheduleEntriesOptions {
  /** The channel's persisted seed; random playback derives from it. */
  channelSeed: number;
  source: ScheduleSource;
  /** The channel's progress through the source collection in its playback mode. */
  progress: PlaybackProgress;
  startsAt: number;
  /** No entry starts at or after this instant; the last one may end past it. */
  through: number;
  nextSequenceNumber: number;
  /** Caps one call so a caller can persist long horizons in bounded chunks. */
  maxEntries: number;
  /** Also stops once this turn's size is met; without one, the source loops to `through`. */
  turn?: TurnSize | undefined;
  /**
   * No entry ends past this instant, such as a reservation's start or end:
   * the next program that would cross it is deferred, not cut.
   */
  hardEnd?: number | undefined;
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
 * Chooses what airs next from a source and advances its progress past it. A
 * single item repeats and leaves progress untouched, because only collections
 * carry playback progress. Random advances its selection index; an ordered
 * mode records the member it selected and the position it held, so the next
 * selection can find that member again after the order changes.
 */
function nextAiring(
  source: ScheduleSource,
  progress: PlaybackProgress,
  channelSeed: number,
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
  const { mediaCollectionId, playbackMode, members } = source;
  if (playbackMode === "random") {
    const selection = selectRandom(
      members,
      deriveCollectionSeed(channelSeed, mediaCollectionId),
      progress.nextSelectionIndex,
    );
    return {
      ...selection,
      mediaCollectionId,
      playbackMode,
      progress: {
        ...progress,
        nextSelectionIndex: selection.playbackIndex + 1,
      },
    };
  }
  const selection = selectOrdered(members, progress);
  return {
    ...selection,
    mediaCollectionId,
    playbackMode,
    progress: {
      ...progress,
      lastMediaItemId: selection.media.id,
      lastPosition: selection.playbackIndex,
    },
  };
}

/**
 * Generates contiguous schedule entries from `startsAt` until one ends at or
 * past `through`, `maxEntries` is reached, the turn's size is met, or the
 * next program would end past `hardEnd`, without touching persistence. A
 * deferred program consumes no progress, and no later program is searched
 * for in its place, so ordering is preserved (programming spec 0006). A
 * turn counts whole programs, or adds each one's duration toward an airtime
 * target, so its last program may overrun it.
 * The result carries everything needed to resume exactly where it stopped, so
 * chunked calls produce the same entries as one long call. A collection is
 * ordered for its playback mode once, so each entry's playback index is its
 * position in that order. The output depends only on the inputs.
 */
export function generateScheduleEntries(
  options: GenerateScheduleEntriesOptions,
): GenerationResult {
  const { through, maxEntries } = options;
  const reason = findUnschedulableReason(options.source);
  if (reason !== null) {
    return { kind: "unschedulable", reason };
  }
  const source: ScheduleSource =
    options.source.kind === "collection"
      ? {
          ...options.source,
          members: orderMembers(
            options.source.members,
            options.source.playbackMode,
          ),
        }
      : options.source;

  const entries: GeneratedScheduleEntry[] = [];
  let nextStartsAt = options.startsAt;
  let progress = options.progress;
  let sequenceNumber = options.nextSequenceNumber;
  let turn = options.turn;
  let deferred = false;
  while (
    nextStartsAt < through &&
    entries.length < maxEntries &&
    (turn === undefined || turn.accumulated < turn.target)
  ) {
    const airing = nextAiring(source, progress, options.channelSeed);
    // The schedulability check guarantees an integer duration at the floor.
    const durationMs = airing.media.durationMs ?? 0;
    if (
      options.hardEnd !== undefined &&
      !fitsBefore(nextStartsAt, durationMs, options.hardEnd)
    ) {
      deferred = true;
      break;
    }
    entries.push({
      mediaItemId: airing.media.id,
      title: airing.media.title,
      startsAt: nextStartsAt,
      endsAt: nextStartsAt + durationMs,
      durationMs,
      sequenceNumber,
      programmingBlockId: source.programmingBlockId,
      mediaCollectionId: airing.mediaCollectionId,
      playbackMode: airing.playbackMode,
      playbackIndex: airing.playbackIndex,
    });
    nextStartsAt += durationMs;
    sequenceNumber += 1;
    progress = airing.progress;
    if (turn !== undefined) {
      turn = {
        ...turn,
        accumulated:
          turn.accumulated + (turn.kind === "programs" ? 1 : durationMs),
      };
    }
  }

  return {
    kind: "generated",
    entries,
    progress,
    nextSequenceNumber: sequenceNumber,
    generatedThrough: nextStartsAt,
    turn,
    deferred,
  };
}
