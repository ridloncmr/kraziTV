import {
  isFields,
  readGenres,
  readResults,
  readRuntimeMs,
  readTitleSummary,
  text,
  type TmdbTitleSummary,
} from "./tmdb-title.js";

/** A movie's first-release facts from its TMDB details. */
export interface TmdbMovie extends TmdbTitleSummary {
  genres: string[];
  /** The TMDB collection the movie belongs to, kraziTV's franchise. */
  franchise?: { id: number; name: string };
  description?: string;
  /** Shown beside a file's probed duration; never evidence for a match. */
  runtimeMs?: number;
}

// Where a movie body names its title and first release.
const MOVIE_KEYS = { title: "title", date: "release_date" } as const;

/** Reads a `/search/movie` body, or undefined when it is not TMDB's shape. */
export function readMovieSearch(body: unknown): TmdbTitleSummary[] | undefined {
  return readResults(body, (value) => readTitleSummary(value, MOVIE_KEYS));
}

/** Reads a `/movie/{id}` body, or undefined when it is not TMDB's shape. */
export function readMovieDetails(body: unknown): TmdbMovie | undefined {
  const summary = readTitleSummary(body, MOVIE_KEYS);
  if (summary === undefined || !isFields(body)) return undefined;
  const genres = readGenres(body);
  if (genres === undefined) return undefined;

  const movie: TmdbMovie = { ...summary, genres };
  const collection = body.belongs_to_collection;
  if (
    isFields(collection) &&
    Number.isSafeInteger(collection.id) &&
    typeof collection.name === "string"
  ) {
    movie.franchise = { id: collection.id as number, name: collection.name };
  }
  const description = text(body.overview);
  if (description !== undefined) movie.description = description;
  const runtimeMs = readRuntimeMs(body.runtime);
  if (runtimeMs !== undefined) movie.runtimeMs = runtimeMs;
  return movie;
}
