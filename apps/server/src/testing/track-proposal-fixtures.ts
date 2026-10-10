import type { FolderTrack } from "../content-metadata/contracts.js";
const MINUTE = 60_000;

// A track named by its disc and number, running `minutes`.
export function track(
  disc: number | null,
  number: number,
  minutes: number | null,
  path = `${disc ?? "-"}/t_${number}.mkv`,
): FolderTrack {
  return {
    mediaItemId: `d${disc ?? "-"}t${number}`,
    path,
    disc,
    track: number,
    durationMs: minutes === null ? null : minutes * MINUTE,
  };
}
