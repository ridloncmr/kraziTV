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

/**
 * Answers the real TmdbClient's requests the way TMDB would, so tests
 * exercise the client's own status mapping, retries, and response reading
 * instead of a looser fake. It accepts only `validKeys`, records the Bearer
 * token and URL of each call, and fails every call as a network error while
 * `unreachable` is set. A search finds every known movie whose title contains
 * the query, ignoring case, filtered by any year; details answer by ID. It
 * normally answers at once and ignores the abort signal; an optional barrier
 * models a delayed answer, but cannot model cancellation or a timeout.
 */
export class ScriptedTmdbFetch {
  readonly validKeys = new Set<string>();
  readonly movies: ScriptedMovie[] = [];
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
    const id = /^\/3\/movie\/(\d+)$/.exec(url.pathname)?.[1];
    const movie = this.movies.find((known) => String(known.id) === id);
    if (movie === undefined) {
      return Response.json({ status_code: 34 }, { status: 404 });
    }
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
}
