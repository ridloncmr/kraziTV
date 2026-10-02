import type { ScheduleMedia } from "./contracts.js";
import { isSchedulableMedia } from "./schedule-policy.js";
import { hash32 } from "./seeded-hash.js";

/** One member chosen to air, the playback index it consumed, and the next one. */
interface PlaybackSelection {
  media: ScheduleMedia;
  playbackIndex: number;
  nextIndex: number;
}

/**
 * Chooses the next chronological member at or after `position`, taken modulo
 * the current member count. An unschedulable member is skipped but still
 * consumes its position, so a member returning later keeps its place in
 * order. The caller must pass members with at least one schedulable item, or
 * the search never ends.
 */
export function selectChronological(
  members: readonly ScheduleMedia[],
  position: number,
): PlaybackSelection {
  let index = position % members.length;
  for (;;) {
    const media = members[index];
    const nextIndex = (index + 1) % members.length;
    if (media !== undefined && isSchedulableMedia(media)) {
      return { media, playbackIndex: index, nextIndex };
    }
    index = nextIndex;
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
  return {
    media,
    playbackIndex: selectionIndex,
    nextIndex: selectionIndex + 1,
  };
}
