import type { PathHints } from "../path-hints/contracts.js";
import type { TmdbMovieSummary } from "../tmdb/tmdb-movie.js";
import { normalizeTitle } from "./normalize-title.js";

/** The path hints a movie lookup uses. */
export type MovieHints = Required<Pick<PathHints, "title" | "strength">> &
  Pick<PathHints, "year">;

/** How a movie search's results resolve against the hints that built it. */
type MovieMatch =
  | { kind: "matched"; movie: TmdbMovieSummary }
  | { kind: "ambiguous"; candidates: TmdbMovieSummary[] }
  | { kind: "unmatched" };

/**
 * Applies the spec's movie rule: a match only when strong hints leave exactly
 * one result with the same title and a year agreeing with any year hint.
 * Popularity and TMDB's order never break a tie, so anything else is left for
 * the user, offering the agreeing results, or every result when none agrees.
 */
export function matchMovie(
  hints: MovieHints,
  results: readonly TmdbMovieSummary[],
): MovieMatch {
  if (results.length === 0) return { kind: "unmatched" };
  const title = normalizeTitle(hints.title);
  const agreeing = results.filter(
    (movie) =>
      normalizeTitle(movie.title) === title &&
      (hints.year === undefined || releaseYear(movie) === hints.year),
  );
  const [only] = agreeing;
  if (
    hints.strength === "strong" &&
    only !== undefined &&
    agreeing.length === 1
  ) {
    return { kind: "matched", movie: only };
  }
  return {
    kind: "ambiguous",
    candidates: agreeing.length > 0 ? agreeing : [...results],
  };
}

// The year of first release, or undefined when TMDB does not know it.
function releaseYear(movie: TmdbMovieSummary): number | undefined {
  return movie.releaseDate === undefined
    ? undefined
    : Number(movie.releaseDate.slice(0, 4));
}
