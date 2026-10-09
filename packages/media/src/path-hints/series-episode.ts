import type { PathHints } from "./contracts.js";
import { currentPathPlatform, type PathPlatform } from "../paths/media-path.js";

/** An episode file's place in the series it shares with other files. */
interface SeriesEpisode {
  /**
   * The same for every file under one series folder with the same series
   * name and year, using the filesystem's folder identity rules.
   */
  key: string;
  series: string;
  season: number;
  episode: { first: number; last: number };
}

/**
 * Places an episode file in its shared series, or returns undefined for
 * anything else. Files with equal keys share one series search, and one
 * owner's choice of series; a file needs a series name, series folder,
 * season, and episode to join.
 */
export function seriesEpisode(
  hints: PathHints,
  platform: PathPlatform = currentPathPlatform(),
): SeriesEpisode | undefined {
  const { series, seriesFolder, season, episode, year } = hints;
  if (
    series === undefined ||
    seriesFolder === undefined ||
    season === undefined ||
    episode === undefined
  ) {
    return undefined;
  }
  const key = [
    platform === "win32" ? seriesFolder.toLowerCase() : seriesFolder,
    series.toLowerCase(),
    year ?? "",
  ].join("\u0000");
  return { key, series, season, episode };
}
