// Test-only stand-in for TMDB over HTTP; production code must never import this module.
import type { TestBarrier } from "./test-barrier.js";

/** A movie the scripted TMDB knows, from which it answers searches and details. */
export interface ScriptedMovie {
  id: number;
  title: string;
  /** `YYYY-MM-DD`, or absent when TMDB does not know it. */
  releaseDate?: string;
  genres?: string[];
  franchise?: { id: number; name: string };
}

/** A series the scripted TMDB knows, from which it answers searches, details, and seasons. */
export interface ScriptedSeries {
  id: number;
  name: string;
  /** `YYYY-MM-DD`, or absent when TMDB does not know it. */
  firstAirDate?: string;
  /** Episodes per season number; season `0` holds specials. */
  episodeCounts: Record<number, number>;
}

/**
 * Answers the real TmdbClient's requests the way TMDB would, so tests
 * exercise the client's own status mapping, retries, and response reading
 * instead of a looser fake. It accepts only `validKeys`, records the Bearer
 * token and URL of each call, and fails every call as a network error while
 * `unreachable` is set. A search finds every known movie or series whose name
 * contains the query, ignoring case, filtered by any year; details and
 * seasons answer by ID. It normally answers at once and ignores the abort
 * signal; an optional barrier models a delayed answer, but cannot model
 * cancellation or a timeout.
 */
export class ScriptedTmdbFetch {
  readonly validKeys = new Set<string>();
  readonly movies: ScriptedMovie[] = [];
  readonly series: ScriptedSeries[] = [];
  unreachable = false;
  /**
   * Statuses forced on the next lookups, in order, leaving key checks alone;
   * a `429` names `Retry-After: 0`.
   */
  readonly forcedStatuses: number[] = [];
  /** Pauses the next call to each path, so tests can hold one lookup. */
  readonly holds = new Map<string, TestBarrier>();
  /** The token each request carried, in call order. */
  readonly tokens: string[] = [];
  /** Each request's URL, in call order. */
  readonly requests: URL[] = [];
  /** Pauses only the next call, so tests can interleave a replacement or removal. */
  nextCallBarrier?: TestBarrier;

  /** The fetch to hand TmdbClient; bound so it can be passed bare. */
  readonly fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const token = new Headers(init?.headers)
      .get("authorization")
      ?.replace(/^Bearer /, "");
    const url = new URL(input instanceof Request ? input.url : String(input));
    this.tokens.push(token ?? "");
    this.requests.push(url);
    const barrier = this.nextCallBarrier ?? this.holds.get(url.pathname);
    this.nextCallBarrier = undefined;
    this.holds.delete(url.pathname);
    if (barrier) await barrier.wait();
    if (this.unreachable) throw new TypeError("fetch failed");
    const forced =
      url.pathname === "/3/authentication"
        ? undefined
        : this.forcedStatuses.shift();
    if (forced !== undefined) {
      return new Response(null, {
        status: forced,
        headers: { "retry-after": "0" },
      });
    }
    if (token === undefined || !this.validKeys.has(token)) {
      return Response.json({ success: false, status_code: 7 }, { status: 401 });
    }
    return this.#answer(url);
  };

  /** The paths of every request so far, in call order. */
  paths(): string[] {
    return this.requests.map((url) => url.pathname);
  }

  // Answers an authorized request by its path, as TMDB would.
  #answer(url: URL): Response {
    if (url.pathname === "/3/authentication") {
      return Response.json({ success: true, status_code: 1 });
    }
    if (url.pathname === "/3/search/movie") {
      const query = (url.searchParams.get("query") ?? "").toLowerCase();
      const year = url.searchParams.get("year");
      return Response.json({
        page: 1,
        results: this.movies
          .filter(
            (movie) =>
              movie.title.toLowerCase().includes(query) &&
              (year === null || movie.releaseDate?.startsWith(year)),
          )
          .map((movie) => ({
            id: movie.id,
            title: movie.title,
            release_date: movie.releaseDate ?? "",
            poster_path: `/poster-${movie.id}.jpg`,
          })),
      });
    }
    if (url.pathname === "/3/search/tv") return this.#searchSeries(url);
    const tv = /^\/3\/tv\/(\d+)(?:\/season\/(\d+))?$/.exec(url.pathname);
    if (tv) return this.#answerSeries(tv[1], tv[2]);
    const id = /^\/3\/movie\/(\d+)$/.exec(url.pathname)?.[1];
    const movie = this.movies.find((known) => String(known.id) === id);
    if (movie === undefined) return notFound();
    return Response.json({
      id: movie.id,
      title: movie.title,
      release_date: movie.releaseDate ?? "",
      overview: `About ${movie.title}`,
      poster_path: `/poster-${movie.id}.jpg`,
      genres: (movie.genres ?? []).map((name, index) => ({ id: index, name })),
      belongs_to_collection: movie.franchise ?? null,
    });
  }

  // Answers a series search over known series, as a movie search does.
  #searchSeries(url: URL): Response {
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    const year = url.searchParams.get("first_air_date_year");
    return Response.json({
      page: 1,
      results: this.series
        .filter(
          (series) =>
            series.name.toLowerCase().includes(query) &&
            (year === null || series.firstAirDate?.startsWith(year)),
        )
        .map((series) => ({
          id: series.id,
          name: series.name,
          first_air_date: series.firstAirDate ?? "",
          poster_path: `/poster-${series.id}.jpg`,
        })),
    });
  }

  // Answers a series' details, or one season's numbered episodes.
  #answerSeries(id: string | undefined, season: string | undefined): Response {
    const series = this.series.find((known) => String(known.id) === id);
    if (series === undefined) return notFound();
    if (season !== undefined) {
      const count = series.episodeCounts[Number(season)];
      if (count === undefined) return notFound();
      return Response.json({
        season_number: Number(season),
        episodes: Array.from({ length: count }, (_, index) => ({
          episode_number: index + 1,
          name: `${series.name} ${season}x${index + 1}`,
          air_date: series.firstAirDate ?? "",
          overview: "",
        })),
      });
    }
    return Response.json({
      id: series.id,
      name: series.name,
      first_air_date: series.firstAirDate ?? "",
      overview: `About ${series.name}`,
      poster_path: `/poster-${series.id}.jpg`,
      genres: [{ id: 18, name: "Drama" }],
      seasons: Object.entries(series.episodeCounts).map(([number, count]) => ({
        season_number: Number(number),
        episode_count: count,
      })),
    });
  }
}

// TMDB's answer for an ID it does not know.
function notFound(): Response {
  return Response.json({ status_code: 34 }, { status: 404 });
}
