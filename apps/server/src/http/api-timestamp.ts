/** Converts internal epoch milliseconds to the ISO 8601 string the API promises. */
export function toApiTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Converts an optional epoch-millisecond time, keeping "never happened" as null. */
export function toApiTimestampOrNull(epochMs: number | null): string | null {
  return epochMs === null ? null : toApiTimestamp(epochMs);
}
