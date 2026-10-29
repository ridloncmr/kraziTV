/** Formats probed milliseconds as clock time (h:mm:ss or m:ss); null means the probe gave no duration. */
export function displayDuration(ms: number | null): string {
  if (ms === null) return "Unknown";
  const seconds = Math.round(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
