import type { TmdbClient, TmdbMovieQuery } from "../tmdb/tmdb-client.js";
import type { TmdbMovie, TmdbMovieSummary } from "../tmdb/tmdb-movie.js";
import { matchMovie, type MovieHints } from "./match-movie.js";

/**
 * How one movie lookup ended, with the query that produced it as match
 * evidence. Only a match reads details, so an ambiguous title costs one call.
 */
export type MovieLookup = { query: TmdbMovieQuery } & (
  | { kind: "matched"; movie: TmdbMovie }
  | { kind: "ambiguous"; candidates: TmdbMovieSummary[] }
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
  hints: MovieHints,
  signal?: AbortSignal,
): Promise<MovieLookup> {
  let query = toQuery(hints);
  let search = await client.searchMovies(apiKey, query, signal);
  const split = hints.year === undefined && TRAILING_YEAR.exec(hints.title);
  if (search.kind === "ok" && search.value.length === 0 && split) {
    query = { title: split[1] ?? hints.title, year: Number(split[2]) };
    search = await client.searchMovies(apiKey, query, signal);
  }
  if (search.kind === "failed") return { query, ...search };

  const match = matchMovie({ ...hints, ...query }, search.value);
  if (match.kind !== "matched") return { query, ...match };
  const details = await client.movieDetails(apiKey, match.movie.id, signal);
  return details.kind === "ok"
    ? { query, kind: "matched", movie: details.value }
    : { query, ...details };
}

// The query carries only the hints TMDB is sent (ADR 0013).
function toQuery(hints: MovieHints): TmdbMovieQuery {
  return hints.year === undefined
    ? { title: hints.title }
    : { title: hints.title, year: hints.year };
}
