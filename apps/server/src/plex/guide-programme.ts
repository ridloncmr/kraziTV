import type { GuideProgramme } from "@krazitv/plex";

import type { ContentMetadata } from "../media-items/contracts.js";

// TMDB serves posters by width from this base; kraziTV stores only the path.
// w500 suits a guide tile; the Media Library picks its own widths.
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

/**
 * Words one schedule entry for the Plex guide from the media's effective
 * content metadata, so Plex lists what the Media Library shows: an episode
 * under its series title with its own title and numbers, a movie under its
 * TMDB title with its year, and either with its description, genres, and
 * poster. Media with no facts, or an extra, lists by the entry's own title,
 * as the guide always has.
 */
export function guideProgramme(
  entry: { title: string; startsAt: number; endsAt: number },
  metadata: ContentMetadata | undefined,
): GuideProgramme {
  const base = { startsAt: entry.startsAt, endsAt: entry.endsAt };
  if (metadata === undefined || metadata.matchState === "extra")
    return { ...base, title: entry.title };
  const facts = {
    description: metadata.description,
    date: metadata.releaseDate?.replaceAll("-", "") ?? null,
    iconUrl:
      metadata.posterPath === null
        ? null
        : `${POSTER_BASE}${metadata.posterPath}`,
  };
  if (metadata.seriesName !== null)
    return {
      ...base,
      ...facts,
      title: metadata.seriesName,
      subTitle: metadata.title,
      categories: ["Series", ...metadata.genres],
      episode:
        metadata.seasonNumber !== null && metadata.episodeNumber !== null
          ? {
              season: metadata.seasonNumber,
              episode: metadata.episodeNumber,
              lastEpisode: metadata.lastEpisodeNumber,
            }
          : null,
    };
  if (metadata.title !== null)
    return {
      ...base,
      ...facts,
      title: metadata.title,
      categories: ["Movie", ...metadata.genres],
    };
  return { ...base, title: entry.title };
}
