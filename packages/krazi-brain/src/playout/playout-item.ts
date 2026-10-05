import type { PlayoutEntry, PlayoutItem, PlayoutMedia } from "./contracts.js";

type PlayableMedia = PlayoutMedia & {
  status: "available";
  durationMs: number;
  hasAudio: boolean;
};

/**
 * Media is playable when it is available, has a positive integer duration,
 * and has a known audio fact packaging needs. It shares the schedulable
 * integer check but has no duration floor.
 */
function isPlayableMedia(media: PlayoutMedia): media is PlayableMedia {
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
): PlayoutItem | null {
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
 * Maps a window's entries to the playout items the channel transmits, in
 * order. Unplayable entries are omitted rather than replaced, because the
 * playout timeline never invents programming the schedule does not list.
 */
export function buildPlayoutTimeline({
  channelId,
  scheduleRevision,
  entries,
}: {
  channelId: string;
  scheduleRevision: number;
  entries: readonly PlayoutEntry[];
}): PlayoutItem[] {
  return entries.flatMap(
    (entry) => toPlayoutItem(entry, channelId, scheduleRevision) ?? [],
  );
}
