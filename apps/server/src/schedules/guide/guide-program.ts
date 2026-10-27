import type { ContentMetadata } from "../../media-items/contracts.js";
import type { MediaItemRepository } from "../../media-items/media-item-repository.js";
import type { GuideProgram, ScheduleEntry } from "../contracts.js";

// TMDB serves posters by width from this base; kraziTV stores only the path.
// w500 suits a guide tile; the Media Library picks its own widths.
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

/** A program with no facts: the entry's own title, as the guide always listed it. */
const bare = (title: string): GuideProgram => ({
  title,
  subTitle: null,
  description: null,
  releaseDate: null,
  kind: null,
  genres: [],
  posterUrl: null,
  episode: null,
});

/**
 * Words one entry as a guide program from its media's effective metadata,
 * so every guide lists what the Media Library shows and a correction wins
 * here exactly as it does there. An extra is bonus material, never an
 * episode or movie, so it reads bare like media with no facts.
 */
export function guideProgram(
  entryTitle: string,
  metadata: ContentMetadata | undefined,
): GuideProgram {
  if (metadata === undefined || metadata.matchState === "extra")
    return bare(entryTitle);
  const facts = {
    description: metadata.description,
    releaseDate: metadata.releaseDate,
    genres: metadata.genres,
    posterUrl:
      metadata.posterPath === null
        ? null
        : `${POSTER_BASE}${metadata.posterPath}`,
  };
  if (metadata.seriesName !== null)
    return {
      ...facts,
      kind: "episode",
      title: metadata.seriesName,
      subTitle: metadata.title,
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
      ...facts,
      kind: "movie",
      title: metadata.title,
      subTitle: null,
      episode: null,
    };
  return bare(entryTitle);
}

/**
 * Words every entry of a window beside its entry, in order, reading the
 * window's media in one query. Read after the window, outside its
 * snapshot: a title or description a beat newer than the entries is
 * harmless.
 */
export async function guidePrograms(
  mediaItems: MediaItemRepository,
  entries: readonly ScheduleEntry[],
): Promise<{ entry: ScheduleEntry; program: GuideProgram }[]> {
  const items = await mediaItems.listByIds(
    entries.map((entry) => entry.mediaItemId),
  );
  return entries.map((entry) => ({
    entry,
    program: guideProgram(entry.title, items.get(entry.mediaItemId)?.metadata),
  }));
}
