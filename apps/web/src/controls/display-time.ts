/**
 * The fields `toLocaleString` shows by default, built once: `toLocaleString`
 * constructs a formatter per call, which dominated long guide renders.
 */
const instantFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** Formats an API instant as a time of day, for when something airing ends. */
export function displayClockTime(value: string): string {
  return clockFormat.format(new Date(value));
}

/** Formats API instants for observation, never deriving authoritative playback state. */
export function displayTime(value: string | null): string {
  return value ? instantFormat.format(new Date(value)) : "Not yet scanned";
}
