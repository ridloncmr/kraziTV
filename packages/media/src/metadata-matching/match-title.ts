import type { PathHints } from "../path-hints/contracts.js";
import type { TmdbTitleQuery } from "../tmdb/tmdb-client.js";
import type { TmdbTitleSummary } from "../tmdb/tmdb-title.js";
import { normalizeTitle } from "./normalize-title.js";

/** The path hints a movie or series lookup uses; a series' name is its title. */
export type TitleHints = Required<Pick<PathHints, "title" | "strength">> &
  Pick<PathHints, "year">;

/** How a movie or series search's results resolve against the hints that built it. */
type TitleMatch<T extends TmdbTitleSummary> =
  | { kind: "matched"; result: T }
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "unmatched" };

/**
 * Applies the spec's title rule, which movies and series share: a match only
 * when strong hints leave exactly one result with the same title and a year
 * agreeing with any year hint. Popularity and TMDB's order never break a tie,
 * so anything else is left for the user, offering the agreeing results, or
 * every result when none agrees.
 */
export function matchTitle<T extends TmdbTitleSummary>(
  hints: TitleHints,
  results: readonly T[],
): TitleMatch<T> {
  if (results.length === 0) return { kind: "unmatched" };
  const agreeing = agreeingResults(hints, results);
  const [only] = agreeing;
  if (
    hints.strength === "strong" &&
    only !== undefined &&
    agreeing.length === 1
  ) {
    return { kind: "matched", result: only };
  }
  return {
    kind: "ambiguous",
    candidates: agreeing.length > 0 ? agreeing : [...results],
  };
}

// The results whose title and first-release year agree with the hints, in
// TMDB's order.
function agreeingResults<T extends TmdbTitleSummary>(
  hints: Pick<TitleHints, "title" | "year">,
  results: readonly T[],
): T[] {
  const title = normalizeTitle(hints.title);
  return results.filter(
    (result) =>
      normalizeTitle(result.title) === title &&
      (hints.year === undefined || releaseYear(result) === hints.year),
  );
}

// The year of first release, or undefined when TMDB does not know it.
function releaseYear(result: TmdbTitleSummary): number | undefined {
  return result.releaseDate === undefined
    ? undefined
    : Number(result.releaseDate.slice(0, 4));
}

/** The query a lookup sends: only the hints TMDB is told (ADR 0013). */
export function titleQuery(hints: TitleHints): TmdbTitleQuery {
  return hints.year === undefined
    ? { title: hints.title }
    : { title: hints.title, year: hints.year };
}
