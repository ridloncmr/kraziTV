import type {
  PlayoutEntry,
  PlayoutItem,
  PlayoutMedia,
  ProgramPlayoutItem,
} from "./contracts.js";
import { findFillerAt, type FillerInputs } from "./filler.js";

type PlayableFacts = {
  status: "available";
  durationMs: number;
  hasAudio: boolean;
};

/**
 * Media is playable when it is available, has a positive integer duration,
 * and has a known audio fact packaging needs. It shares the schedulable
 * integer check but has no duration floor. Exported so the server can
 * refuse to reserve what could never be transmitted.
 */
export function isPlayableMedia<
  Media extends Pick<PlayoutMedia, "status" | "durationMs" | "hasAudio">,
>(media: Media): media is Media & PlayableFacts {
  return (
    media.status === "available" &&
    Number.isSafeInteger(media.durationMs) &&
    (media.durationMs ?? 0) > 0 &&
    media.hasAudio !== null
  );
}

/**
 * Derives the program playout item for one schedule entry, or null when its
 * media is not playable, because only playable entries become playout items.
 */
export function toPlayoutItem(
  entry: PlayoutEntry,
  channelId: string,
  scheduleRevision: number,
): ProgramPlayoutItem | null {
  const { media } = entry;
  if (!isPlayableMedia(media)) {
    return null;
  }
  return {
    type: "program",
    channelId,
    scheduleRevision,
    scheduleEntryId: entry.id,
    mediaItemId: entry.mediaItemId,
    mediaPath: media.path,
    hasAudio: media.hasAudio,
    // Unlike audio, an unknown video fact never blocks playout: media
    // cataloged before video detection keeps its video until a rescan.
    hasVideo: media.hasVideo ?? true,
    title: entry.title,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    durationMs: media.durationMs,
    startOffsetMs: 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Returns the playable item starting exactly at `at`, a program or planned
 * filler, or null, because only an item airing exactly when the previous
 * one ends follows it.
 */
export function itemStartingAt(
  at: number,
  entries: readonly PlayoutEntry[],
  filler: FillerInputs,
): PlayoutItem | null {
  const next = entries.find((entry) => entry.startsAt === at);
  if (next !== undefined) {
    return toPlayoutItem(next, filler.channelId, filler.scheduleRevision);
  }
  const planned = findFillerAt(at, entries, filler);
  return planned?.startsAt === at ? planned : null;
}

/**
 * Lists everything a channel transmits overlapping `window`, in order:
 * programs for playable entries and planned filler between them (ADR
 * 0014). Unplayable entries and unexplained gaps are omitted rather than
 * replaced, because the playout timeline never invents programming the
 * schedule does not list.
 *
 * `entries` must be in start order and hold every entry overlapping the
 * window, the last one before it, and the first one after it.
 */
export function buildPlayoutTimeline({
  window,
  entries,
  ...filler
}: FillerInputs & {
  window: { start: number; end: number };
  entries: readonly PlayoutEntry[];
}): PlayoutItem[] {
  const items: PlayoutItem[] = [];
  let at = window.start;
  while (at < window.end) {
    const instant = at;
    const covering = entries.find(
      (entry) => entry.startsAt <= instant && instant < entry.endsAt,
    );
    const planned =
      covering === undefined ? findFillerAt(at, entries, filler) : undefined;
    if (covering !== undefined) {
      const item = toPlayoutItem(
        covering,
        filler.channelId,
        filler.scheduleRevision,
      );
      if (item !== null) items.push(item);
      at = covering.endsAt;
    } else if (planned !== undefined) {
      items.push(planned);
      at = planned.endsAt;
    } else {
      // An unexplained gap: skip to the next entry, if any.
      at =
        entries.find((entry) => entry.startsAt > instant)?.startsAt ?? Infinity;
    }
  }
  return items;
}
