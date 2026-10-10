import type { TmdbClient, TmdbTitleQuery } from "../tmdb/tmdb-client.js";
import type { TmdbMovie } from "../tmdb/tmdb-movie.js";
import type { TmdbTitleSummary } from "../tmdb/tmdb-title.js";
import { matchTitle, titleQuery, type TitleHints } from "./match-title.js";

/**
 * How one movie lookup ended, with the query that produced it as match
 * evidence. Only a match reads details, so an ambiguous title costs one call.
 */
export type MovieLookup = { query: TmdbTitleQuery } & (
  | { kind: "matched"; movie: TmdbMovie }
  | { kind: "ambiguous"; candidates: TmdbTitleSummary[] }
  | { kind: "unmatched" }
  | { kind: "failed"; reason: string }
);

// A year ending a title, as `Gladiator.2000.mkv` leaves it when no release
// token follows to mark it a year (META-001's scene-style note).
const TRAILING_YEAR = /^(.+?)\s+((?:19|20)\d{2})$/u;

/**
 * Searches TMDB for a movie from its path hints and applies the movie rule.
 * When the whole name finds nothing and ends in a year, it searches once more
 * with that year split off, so `Blade Runner 2049` keeps its number while
 * `Gladiator 2000` still finds Gladiator. The caller's abort is rethrown.
 */
export async function lookUpMovie(
  client: TmdbClient,
  apiKey: string,
  hints: TitleHints,
  signal?: AbortSignal,
): Promise<MovieLookup> {
  let query = titleQuery(hints);
  let search = await client.searchMovies(apiKey, query, signal);
  const split = hints.year === undefined && TRAILING_YEAR.exec(hints.title);
  if (search.kind === "ok" && search.value.length === 0 && split) {
    query = { title: split[1] ?? hints.title, year: Number(split[2]) };
    search = await client.searchMovies(apiKey, query, signal);
  }
  if (search.kind === "failed") return { query, ...search };

  const match = matchTitle({ ...hints, ...query }, search.value);
  if (match.kind !== "matched") return { query, ...match };
  return lookUpMovieById(client, apiKey, match.result.id, query, signal);
}

/**
 * Reads the facts of a movie already identified, by the movie rule or by the
 * owner's choice, keeping `query` as the evidence that led to it.
 */
export async function lookUpMovieById(
  client: TmdbClient,
  apiKey: string,
  id: number,
  query: TmdbTitleQuery,
  signal?: AbortSignal,
): Promise<MovieLookup> {
  const details = await client.movieDetails(apiKey, id, signal);
  return details.kind === "ok"
    ? { query, kind: "matched", movie: details.value }
    : { query, ...details };
}
