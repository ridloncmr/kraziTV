import type { ScheduleMedia } from "./contracts.js";
import { isSchedulableMedia } from "./schedule-policy.js";

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
