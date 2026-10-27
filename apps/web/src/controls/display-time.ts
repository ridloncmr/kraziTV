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

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const shortDayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** Formats an API instant as a time of day, for when something airing ends. */
export function displayClockTime(value: string): string {
  return clockFormat.format(new Date(value));
}

/** Formats an API instant for observation, never deriving authoritative playback state. */
export function displayTime(value: string): string {
  return instantFormat.format(new Date(value));
}

/** Names an instant's day, such as `Monday, October 26`, for a heading over that day's rows. */
export function displayDay(value: string): string {
  return dayFormat.format(new Date(value));
}

/** Names an instant's day briefly, such as `Tue, Oct 27`, where a ruler has room for little. */
export function displayShortDay(value: string): string {
  return shortDayFormat.format(new Date(value));
}

/** Whether two API instants fall on one local calendar day. */
export function isSameDay(a: string, b: string): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

/**
 * Formats an interval as the owner reads it: when it ends on the day it
 * starts, the date once and then both times of day; otherwise both instants
 * in full.
 */
export function displayTimeRange(startsAt: string, endsAt: string): string {
  return isSameDay(startsAt, endsAt)
    ? `${displayTime(startsAt)} – ${displayClockTime(endsAt)}`
    : `${displayTime(startsAt)} – ${displayTime(endsAt)}`;
}

/**
 * Formats the start of one item in a list of them: the full date and time
 * when it begins a new day, after `previous`, and only the time of day
 * otherwise, so a day's worth of rows names its date once.
 */
export function displayListTime(value: string, previous?: string): string {
  return previous !== undefined && isSameDay(previous, value)
    ? displayClockTime(value)
    : displayTime(value);
}
