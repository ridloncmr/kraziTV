import { isNonNegativeSafeInteger } from "@krazitv/process";

import {
  isFields,
  readDate,
  readGenres,
  readResults,
  readTitleSummary,
  text,
  type TmdbTitleSummary,
} from "./tmdb-title.js";

/** One season as a series' details list it: enough to know an episode exists. */
interface TmdbSeasonSummary {
  /** `0` is TMDB's specials season. */
  number: number;
  episodeCount: number;
}

/** A series' first-air facts and its seasons from its TMDB details. */
export interface TmdbSeries extends TmdbTitleSummary {
  genres: string[];
  description?: string;
  seasons: TmdbSeasonSummary[];
}

/** One episode from a TMDB season. Unknown facts are absent, never empty. */
export interface TmdbEpisode {
  number: number;
  title?: string;
  /** First air date, keeping TMDB's precision. */
  airDate?: string;
  description?: string;
}

/** One season's episodes from TMDB, in TMDB's order. */
export interface TmdbSeason {
  number: number;
  episodes: TmdbEpisode[];
}

// Where a series body names itself and its first air date.
const SERIES_KEYS = { title: "name", date: "first_air_date" } as const;

/** Reads a `/search/tv` body, or undefined when it is not TMDB's shape. */
export function readSeriesSearch(
  body: unknown,
): TmdbTitleSummary[] | undefined {
  return readResults(body, (value) => readTitleSummary(value, SERIES_KEYS));
}

/** Reads a `/tv/{id}` body, or undefined when it is not TMDB's shape. */
export function readSeriesDetails(body: unknown): TmdbSeries | undefined {
  const summary = readTitleSummary(body, SERIES_KEYS);
  if (summary === undefined || !isFields(body)) return undefined;
  const genres = readGenres(body);
  if (genres === undefined || !Array.isArray(body.seasons)) return undefined;
  const seasons = body.seasons.map(readSeasonSummary);
  if (!seasons.every((season) => season !== undefined)) return undefined;

  const series: TmdbSeries = { ...summary, genres, seasons };
  const description = text(body.overview);
  if (description !== undefined) series.description = description;
  return series;
}

/** Reads a `/tv/{id}/season/{n}` body, or undefined when it is not TMDB's shape. */
export function readSeasonDetails(body: unknown): TmdbSeason | undefined {
  if (!isFields(body) || !isCount(body.season_number)) return undefined;
  if (!Array.isArray(body.episodes)) return undefined;
  const episodes = body.episodes.map(readEpisode);
  return episodes.every((episode) => episode !== undefined)
    ? { number: body.season_number, episodes }
    : undefined;
}

// Reads one entry of a series' `seasons`.
function readSeasonSummary(value: unknown): TmdbSeasonSummary | undefined {
  return isFields(value) &&
    isCount(value.season_number) &&
    isCount(value.episode_count)
    ? { number: value.season_number, episodeCount: value.episode_count }
    : undefined;
}

// Reads one entry of a season's `episodes`.
function readEpisode(value: unknown): TmdbEpisode | undefined {
  if (!isFields(value) || !isCount(value.episode_number)) return undefined;
  const episode: TmdbEpisode = { number: value.episode_number };
  const title = text(value.name);
  if (title !== undefined) episode.title = title;
  const airDate = readDate(value.air_date);
  if (airDate !== undefined) episode.airDate = airDate;
  const description = text(value.overview);
  if (description !== undefined) episode.description = description;
  return episode;
}

// Season and episode numbers and counts are non-negative integers.
function isCount(value: unknown): value is number {
  return typeof value === "number" && isNonNegativeSafeInteger(value);
}
