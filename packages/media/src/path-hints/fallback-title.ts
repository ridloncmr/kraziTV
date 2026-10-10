import type { PathHints } from "./contracts.js";

/**
 * Builds the display title an unmatched media item shows from its path
 * hints, such as `Firefly – S01E05`. Keeps the filename title when the hints
 * cannot name the item better: an extra, an episode without a series, or a
 * season file without an episode number.
 */
export function fallbackTitle(hints: PathHints, filenameTitle: string): string {
  if (hints.extra) return filenameTitle;
  const { series, season, episode, track, disc, title, year } = hints;
  if (series !== undefined && season !== undefined && episode !== undefined) {
    const range = episode.last > episode.first ? `–E${pad(episode.last)}` : "";
    return `${series} – S${pad(season)}E${pad(episode.first)}${range}`;
  }
  if (series !== undefined && track !== undefined) {
    const discLabel = disc !== undefined ? `Disc ${disc} ` : "";
    return `${series} – ${discLabel}Track ${track}`;
  }
  if (title !== undefined) {
    return year !== undefined ? `${title} (${year})` : title;
  }
  return filenameTitle;
}

// Episode codes use at least two digits, as in S01E05.
function pad(value: number): string {
  return String(value).padStart(2, "0");
}
