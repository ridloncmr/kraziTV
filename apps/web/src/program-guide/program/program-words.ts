import type { GuideProgram } from "../../http/contracts/channels.js";

/** An episode's place as a season folder names it, such as `S01E05` or `S01E05-E06`. */
export function episodeCode(
  episode: NonNullable<GuideProgram["episode"]>,
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const last =
    episode.lastEpisode !== null && episode.lastEpisode > episode.episode
      ? `-E${pad(episode.lastEpisode)}`
      : "";
  return `S${pad(episode.season)}E${pad(episode.episode)}${last}`;
}

/**
 * A program's mark beside its time: an episode's code, or a movie's year;
 * null for media without facts, whose title says everything the guide knows.
 */
export function programMark(program: GuideProgram): string | null {
  if (program.episode) return episodeCode(program.episode);
  if (program.kind === "movie" && program.releaseDate)
    return program.releaseDate.slice(0, 4);
  return null;
}
