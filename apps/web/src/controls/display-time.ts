/**
 * Date and time to the minute, built once: `toLocaleString` constructs a
 * formatter per call, which dominated long guide renders. Seconds are left
 * out because a guide, a scan time, or a refresh time is read to the minute.
 */
const instantFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** Formats an API instant as a time of day, for when something airing ends. */
export function displayClockTime(value: string): string {
  return clockFormat.format(new Date(value));
}

/** Formats an API instant for observation, never deriving authoritative playback state. */
export function displayTime(value: string): string {
  return instantFormat.format(new Date(value));
}

/**
 * Formats an interval as the owner reads it: when it ends on the day it
 * starts, the date once and then both times of day; otherwise both instants
 * in full.
 */
export function displayTimeRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  return sameDay
    ? `${displayTime(startsAt)} – ${displayClockTime(endsAt)}`
    : `${displayTime(startsAt)} – ${displayTime(endsAt)}`;
}
