/**
 * One TMDB search result, movie or series: enough to match a title and year
 * and to offer the result as a candidate. Unknown facts are absent, never empty.
 */
export interface TmdbTitleSummary {
  id: number;
  /** A movie's title or a series' name. */
  title: string;
  /** First release or first air date, `YYYY-MM-DD`; a coarser `YYYY-MM` or `YYYY` keeps its precision. */
  releaseDate?: string;
  /** TMDB's image path; the browser loads the image from TMDB. */
  posterPath?: string;
}

/** A parsed JSON object whose fields can be read. */
type Fields = Record<string, unknown>;

/** Where a TMDB body keeps a title's name and first date. */
interface TitleKeys {
  title: "title" | "name";
  date: "release_date" | "first_air_date";
}

// TMDB's own dates, with or without a known month and day.
const PARTIAL_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

/**
 * Reads the fields a movie or series result and its details share, or
 * undefined when `value` is not TMDB's shape. A date TMDB writes in any other
 * form is treated as unknown.
 */
export function readTitleSummary(
  value: unknown,
  keys: TitleKeys,
): TmdbTitleSummary | undefined {
  if (!isFields(value) || !Number.isSafeInteger(value.id)) return undefined;
  const title = text(value[keys.title]);
  if (title === undefined) return undefined;
  const summary: TmdbTitleSummary = { id: value.id as number, title };
  const releaseDate = readDate(value[keys.date]);
  if (releaseDate !== undefined) summary.releaseDate = releaseDate;
  const posterPath = text(value.poster_path);
  if (posterPath !== undefined) summary.posterPath = posterPath;
  return summary;
}

/** Reads a search body's `results` with `read`, or undefined when any is unreadable. */
export function readResults<T>(
  body: unknown,
  read: (value: unknown) => T | undefined,
): T[] | undefined {
  if (!isFields(body) || !Array.isArray(body.results)) return undefined;
  const results = body.results.map(read);
  return results.every((result) => result !== undefined) ? results : undefined;
}

/** Reads a details body's genre names, or undefined when they are not TMDB's shape. */
export function readGenres(body: Fields): string[] | undefined {
  if (!Array.isArray(body.genres)) return undefined;
  const genres = body.genres.map((genre) =>
    isFields(genre) && typeof genre.name === "string" ? genre.name : undefined,
  );
  return genres.every((genre) => genre !== undefined) ? genres : undefined;
}

/** Reads one of TMDB's dates, keeping its precision; anything else is unknown. */
export function readDate(value: unknown): string | undefined {
  const date = text(value);
  return date !== undefined && PARTIAL_DATE.test(date) ? date : undefined;
}

/**
 * Reads TMDB's runtime, in whole minutes, as milliseconds. TMDB sends `0` or
 * null when it does not know one, so only a positive runtime is known.
 */
export function readRuntimeMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value * 60_000
    : undefined;
}

/** TMDB sends an empty string or null for an unknown text fact. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

/** Narrows a parsed JSON value to an object whose fields can be read. */
export function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null;
}
