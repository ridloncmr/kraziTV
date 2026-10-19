import type { TmdbSeries } from "../tmdb/tmdb-series.js";

/** The season and episode hints of one file under a series folder. */
export interface EpisodeHints {
  /** Absent for an episode numbered through the whole series. */
  season?: number;
  episode: { first: number; last: number };
}

/** Where an episode number counted through a whole series lands. */
interface AbsolutePlace {
  season: number;
  episode: number;
}

/** Where a hinted episode sits in a series, as its season list places it. */
interface PlacedEpisode {
  season: number;
  episode: { first: number; last: number };
}

/** The seasons a series lists, as its details summarize them. */
type Seasons = TmdbSeries["seasons"];

/**
 * Locates an episode numbered through the whole series, as anime and
 * TVDB-style libraries number them: the seasons from 1 up in order, each
 * holding as many episodes as TMDB counts for it. Specials never count.
 * Undefined past the last episode.
 */
function locateAbsoluteEpisode(
  seasons: Seasons,
  number: number,
): AbsolutePlace | undefined {
  if (number < 1) return undefined;
  let offset = 0;
  for (const season of [...seasons]
    .filter((season) => season.number > 0)
    .sort((left, right) => left.number - right.number)) {
    if (number <= offset + season.episodeCount) {
      return { season: season.number, episode: number - offset };
    }
    offset += season.episodeCount;
  }
  return undefined;
}

/**
 * Where each hinted episode of one folder sits in a series, read from its
 * season list alone, in `hints` order. An episode with a season the series
 * lists sits there as numbered, unless `countThroughSeries` is allowed and
 * the folder numbers that season through the whole series: every file of
 * the season is numbered past the season's count, and every number counts
 * to that season. An episode with no season always sits where its number
 * counts to. Undefined when the series lists no season for it. A range
 * lands only when both ends land in the same season. Decided per folder
 * rather than per file, so one file numbered just past a season's end, as
 * TMDB and TVDB often disagree, is not read as counting from the series'
 * start; a caller placing files one at a time, or re-reading places already
 * decided, passes `false`.
 */
export function placeEpisodes(
  seasons: Seasons,
  hints: readonly EpisodeHints[],
  countThroughSeries: boolean,
): (PlacedEpisode | undefined)[] {
  const absoluteSeasons = new Set(
    countThroughSeries
      ? [...new Set(hints.flatMap((hint) => hint.season ?? []))].filter(
          (season) =>
            countsThroughSeries(
              seasons,
              season,
              hints.filter((hint) => hint.season === season),
            ),
        )
      : [],
  );
  return hints.map(({ season, episode }) => {
    if (season !== undefined && !absoluteSeasons.has(season)) {
      return seasons.some((listed) => listed.number === season)
        ? { season, episode }
        : undefined;
    }
    const first = locateAbsoluteEpisode(seasons, episode.first);
    const last = locateAbsoluteEpisode(seasons, episode.last);
    return first === undefined ||
      last === undefined ||
      first.season !== last.season
      ? undefined
      : {
          season: first.season,
          episode: { first: first.episode, last: last.episode },
        };
  });
}

// True when a folder's season is numbered through the whole series: the
// series counts fewer episodes than the season's lowest number, and every
// number counts to that very season.
function countsThroughSeries(
  seasons: Seasons,
  season: number,
  hints: readonly EpisodeHints[],
): boolean {
  const listed = seasons.find((candidate) => candidate.number === season);
  if (listed === undefined) return false;
  const numbers = hints.flatMap((hint) => [
    hint.episode.first,
    hint.episode.last,
  ]);
  return (
    Math.min(...numbers) > listed.episodeCount &&
    numbers.every(
      (number) => locateAbsoluteEpisode(seasons, number)?.season === season,
    )
  );
}

/**
 * True when the series lists a season for every hinted episode: the hinted
 * season itself, or the one an absolute number counts to. This is the
 * folder evidence that tells apart same-titled series: only one `The
 * Office` has a season 9.
 */
export function holdsSeasons(
  seasons: Seasons,
  hints: readonly EpisodeHints[],
): boolean {
  return placeEpisodes(seasons, hints, true).every(
    (place) => place !== undefined,
  );
}

/**
 * True when every hinted episode falls within the episode count of the
 * season it is placed in. Finer than `holdsSeasons`, for same-titled series
 * that list the same seasons; TMDB's counts are a summary, so the lookup
 * still reads each season before matching an episode.
 */
export function holdsEpisodes(
  seasons: Seasons,
  hints: readonly EpisodeHints[],
): boolean {
  return placeEpisodes(seasons, hints, true).every((place) => {
    const listed = seasons.find((season) => season.number === place?.season);
    return (
      place !== undefined &&
      listed !== undefined &&
      place.episode.last <= listed.episodeCount
    );
  });
}
