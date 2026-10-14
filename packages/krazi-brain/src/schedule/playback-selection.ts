import type { PlaybackProgress, ScheduleMedia } from "./contracts.js";
import { isSchedulableMedia } from "./schedule-policy.js";
import { hash32 } from "./seeded-hash.js";

/** One member chosen to air and the position or index it consumed. */
interface PlaybackSelection {
  media: ScheduleMedia;
  playbackIndex: number;
}

/**
 * Returns where an ordered mode resumes (ADR 0009): after the last selected
 * member wherever it now sits, or at its recorded position modulo the member
 * count when it has left, or at the start before any selection. Checks the
 * recorded position first, so an unchanged order resumes without a search.
 */
function resumePosition(
  members: readonly ScheduleMedia[],
  { lastMediaItemId, lastPosition }: PlaybackProgress,
): number {
  const found =
    lastMediaItemId === null
      ? -1
      : lastPosition !== null && members[lastPosition]?.id === lastMediaItemId
        ? lastPosition
        : members.findIndex((media) => media.id === lastMediaItemId);
  if (found !== -1) return (found + 1) % members.length;
  return lastPosition === null ? 0 : lastPosition % members.length;
}

/**
 * Chooses the next member of an ordered view after `progress`, skipping
 * unschedulable members and wrapping at the end. Shared by every ordered
 * mode; the caller passes members already in that mode's order, with at
 * least one schedulable item, or the search never ends.
 */
export function selectOrdered(
  members: readonly ScheduleMedia[],
  progress: PlaybackProgress,
): PlaybackSelection {
  let index = resumePosition(members, progress);
  for (;;) {
    const media = members[index];
    if (media !== undefined && isSchedulableMedia(media)) {
      return { media, playbackIndex: index };
    }
    index = (index + 1) % members.length;
  }
}

/**
 * Chooses the random member for `selectionIndex` from the collection seed and
 * that index alone, so any index is reproducible without replaying earlier
 * ones. Picks among schedulable members in membership order, so every index
 * airs something; modulo bias is accepted. The caller must pass members with
 * at least one schedulable item.
 */
export function selectRandom(
  members: readonly ScheduleMedia[],
  collectionSeed: number,
  selectionIndex: number,
): PlaybackSelection {
  const schedulable = members.filter(isSchedulableMedia);
  const pick =
    hash32(`select:${collectionSeed}:${selectionIndex}`) % schedulable.length;
  const media = schedulable[pick];
  if (media === undefined) {
    throw new Error("random selection needs a schedulable member");
  }
  return { media, playbackIndex: selectionIndex };
}
