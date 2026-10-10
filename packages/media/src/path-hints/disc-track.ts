import type { PathHints } from "./contracts.js";
import { folderIdentity } from "./series-episode.js";
import { currentPathPlatform, type PathPlatform } from "../paths/media-path.js";

/** A disc-track file's place among the tracks the owner maps together. */
interface DiscTrack {
  /**
   * The same for every track under one series folder and season, whatever
   * its disc folder, using the filesystem's folder identity rules.
   */
  key: string;
  series?: string;
  season?: number;
  disc?: number;
  track: number;
}

/**
 * Places a disc-track file among the tracks of its rip, or returns undefined
 * for anything else. Tracks with equal keys are mapped to one season's
 * episodes together; another season folder is another mapping, since one
 * season's episodes never number a different season's tracks.
 */
export function discTrack(
  hints: PathHints,
  platform: PathPlatform = currentPathPlatform(),
): DiscTrack | undefined {
  const { track, seriesFolder, series, season, disc } = hints;
  if (track === undefined || seriesFolder === undefined || hints.extra) {
    return undefined;
  }
  const key = [folderIdentity(seriesFolder, platform), season ?? ""].join(
    "\u0000",
  );
  return {
    key,
    track,
    ...(series === undefined ? {} : { series }),
    ...(season === undefined ? {} : { season }),
    ...(disc === undefined ? {} : { disc }),
  };
}
