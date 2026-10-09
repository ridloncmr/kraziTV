/**
 * One TMDB movie search result: enough to match a title and year and to offer
 * the movie as a candidate. Unknown facts are absent, never empty.
 */
export interface TmdbMovieSummary {
  id: number;
  title: string;
  /** First release, `YYYY-MM-DD`; a coarser `YYYY-MM` or `YYYY` keeps its precision. */
  releaseDate?: string;
  /** TMDB's image path; the browser loads the image from TMDB. */
  posterPath?: string;
}

/** A movie's first-release facts from its TMDB details. */
export interface TmdbMovie extends TmdbMovieSummary {
  genres: string[];
  /** The TMDB collection the movie belongs to, kraziTV's franchise. */
  franchise?: { id: number; name: string };
  description?: string;
}

type Fields = Record<string, unknown>;

// TMDB's own dates, with or without a known month and day.
const PARTIAL_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

/** Reads a `/search/movie` body, or undefined when it is not TMDB's shape. */
export function readMovieSearch(body: unknown): TmdbMovieSummary[] | undefined {
  if (!isFields(body) || !Array.isArray(body.results)) return undefined;
  const movies = body.results.map(readSummary);
  return movies.every((movie) => movie !== undefined) ? movies : undefined;
}

/** Reads a `/movie/{id}` body, or undefined when it is not TMDB's shape. */
export function readMovieDetails(body: unknown): TmdbMovie | undefined {
  const summary = readSummary(body);
  if (summary === undefined || !isFields(body)) return undefined;
  if (!Array.isArray(body.genres)) return undefined;
  const genres = body.genres.map((genre) =>
    isFields(genre) && typeof genre.name === "string" ? genre.name : undefined,
  );
  if (!genres.every((genre) => genre !== undefined)) return undefined;

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
  return movie;
}

// Reads the fields a search result and a details body share.
function readSummary(value: unknown): TmdbMovieSummary | undefined {
  if (!isFields(value) || !Number.isSafeInteger(value.id)) return undefined;
  const title = text(value.title);
  if (title === undefined) return undefined;
  const summary: TmdbMovieSummary = { id: value.id as number, title };
  const releaseDate = text(value.release_date);
  if (releaseDate !== undefined && PARTIAL_DATE.test(releaseDate)) {
    summary.releaseDate = releaseDate;
  }
  const posterPath = text(value.poster_path);
  if (posterPath !== undefined) summary.posterPath = posterPath;
  return summary;
}

// TMDB sends an empty string or null for an unknown text fact.
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

// Narrows a parsed JSON value to an object whose fields can be read.
function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null;
}
