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

/** Formats API instants for observation, never deriving authoritative playback state. */
export function displayTime(value: string | null): string {
  return value ? instantFormat.format(new Date(value)) : "Not yet scanned";
}
