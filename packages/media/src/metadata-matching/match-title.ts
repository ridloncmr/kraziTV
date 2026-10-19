import type { PathHints } from "../path-hints/contracts.js";
import type { TmdbTitleQuery } from "../tmdb/tmdb-client.js";
import type { TmdbTitleSummary } from "../tmdb/tmdb-title.js";
import { normalizeTitle } from "../titles/normalize-title.js";

/** The path hints a movie or series lookup uses; a series' name is its title. */
export type TitleHints = Required<Pick<PathHints, "title" | "strength">> &
  Pick<PathHints, "year" | "country">;

/** How a movie or series search's results resolve against the hints that built it. */
type TitleMatch<T extends TmdbTitleSummary> =
  | { kind: "matched"; result: T }
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "unmatched" };

/**
 * Applies the spec's title rule, which movies and series share: a match only
 * from strong hints, when exactly one result has the same title and a year
 * agreeing with any year hint, or when a search constrained by a year hint
 * found exactly one result of that year, since a title TMDB spells
 * differently is still the one release of that year. A country hint such as `(US)` tells apart
 * same-titled results by origin. Popularity and TMDB's order never break a
 * tie, so anything else is left for the user, offering the agreeing results,
 * or every result when none agrees.
 */
export function matchTitle<T extends TmdbTitleSummary>(
  hints: TitleHints,
  results: readonly T[],
): TitleMatch<T> {
  if (results.length === 0) return { kind: "unmatched" };
  const agreeing = agreeingResults(hints, results);
  const [only] = agreeing;
  if (hints.strength === "strong") {
    if (only !== undefined && agreeing.length === 1) {
      return { kind: "matched", result: only };
    }
    const [lone] = results;
    if (
      lone !== undefined &&
      results.length === 1 &&
      hints.year !== undefined &&
      releaseYear(lone) === hints.year
    ) {
      return { kind: "matched", result: lone };
    }
  }
  return {
    kind: "ambiguous",
    candidates: agreeing.length > 0 ? agreeing : [...results],
  };
}

/**
 * The results whose title agrees with the hints, ignoring any year, in
 * TMDB's order. A series search repeated without its year hint reads its
 * results this way, since the year was what kept the right series out.
 */
export function sameTitledResults<T extends TmdbTitleSummary>(
  hints: Pick<TitleHints, "title" | "country">,
  results: readonly T[],
): T[] {
  return agreeingResults(
    { title: hints.title, country: hints.country },
    results,
  );
}

/**
 * The results whose title and first-release year agree with the hints, in
 * TMDB's order; among several, those from the hinted country when any is.
 * Only these are ever checked against a series folder's seasons.
 */
export function agreeingResults<T extends TmdbTitleSummary>(
  hints: Pick<TitleHints, "title" | "year" | "country">,
  results: readonly T[],
): T[] {
  const title = normalizeTitle(hints.title);
  const agreeing = results.filter(
    (result) =>
      normalizeTitle(result.title) === title &&
      (hints.year === undefined || releaseYear(result) === hints.year),
  );
  const { country } = hints;
  if (country === undefined || agreeing.length < 2) return agreeing;
  const fromCountry = agreeing.filter((result) =>
    result.originCountries?.includes(country),
  );
  return fromCountry.length > 0 ? fromCountry : agreeing;
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
