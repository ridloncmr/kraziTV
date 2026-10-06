/** Formats API instants for observation, never deriving authoritative playback state. */
export function displayTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not yet scanned";
}
