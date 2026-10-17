import type {
  ScheduleMedia,
  ScheduleSource,
  UnschedulableReason,
} from "./contracts.js";

/** How far beyond the current time a channel's schedule stays materialized. */
export const SCHEDULE_HORIZON_MS = 72 * 60 * 60 * 1000;

/**
 * The shortest duration a media item may have and still be scheduled. The
 * floor bounds how many entries one malformed or very short file can generate
 * across the horizon.
 */
export const MIN_SCHEDULABLE_DURATION_MS = 1000;

/**
 * A media item is schedulable when it is available and has an integer
 * duration at or above the floor, so every entry built from it has integer,
 * contiguous times.
 */
export function isSchedulableMedia(
  media: Pick<ScheduleMedia, "status" | "durationMs">,
): boolean {
  return (
    media.status === "available" &&
    Number.isSafeInteger(media.durationMs) &&
    (media.durationMs ?? 0) >= MIN_SCHEDULABLE_DURATION_MS
  );
}

/**
 * Returns why a source can produce no entry, or null when it can. Generation
 * checks this first so selection never searches a source with nothing to air.
 */
export function findUnschedulableReason(
  source: ScheduleSource,
): UnschedulableReason | null {
  if (source.kind === "media_item") {
    return isSchedulableMedia(source.media) ? null : "media_item_unschedulable";
  }
  if (source.members.length === 0) {
    return "empty_collection";
  }
  return source.members.some(isSchedulableMedia)
    ? null
    : "no_schedulable_members";
}

/**
 * Whether a program starting at `startsAt` ends at or before a hard end,
 * such as a reservation's start or end: the one fit rule (programming spec
 * 0006). A program that does not fit is deferred whole, never cut.
 */
export function fitsBefore(
  startsAt: number,
  durationMs: number,
  hardEnd: number,
): boolean {
  return startsAt + durationMs <= hardEnd;
}
