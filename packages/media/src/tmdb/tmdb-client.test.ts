import { describe, expect, it, vi } from "vitest";

import { TmdbClient } from "./tmdb-client.js";
import {
  answering,
  hanging,
  heldMovieFetch,
  routedFetch,
} from "../testing/tmdb-fetch.js";
import { ALIEN_DETAILS, searchResult } from "../testing/tmdb-movies.js";

const TOKEN = "eyJ.read-access-token.sig";

describe("TmdbClient.checkKey", () => {
  it("validates the token as a Bearer header against TMDB's authentication route", async () => {
    const { fetch, calls } = answering(200);
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    await expect(client.checkKey(TOKEN)).resolves.toEqual({ kind: "valid" });
    expect(calls).toEqual([
      {
        url: "https://api.themoviedb.org/3/authentication",
        authorization: `Bearer ${TOKEN}`,
      },
    ]);
  });

  it("reports a 401 as a rejected key, not an outage", async () => {
    const client = new TmdbClient({
      fetch: answering(401).fetch,
      timeoutMs: 1_000,
    });

    await expect(client.checkKey(TOKEN)).resolves.toEqual({
      kind: "rejected",
    });
  });

  it.each([429, 500, 503])(
    "reports a %i as unreachable, naming the status",
    async (status) => {
      const client = new TmdbClient({
        fetch: answering(status).fetch,
        timeoutMs: 1_000,
      });

      await expect(client.checkKey(TOKEN)).resolves.toEqual({
        kind: "unreachable",
        reason: `TMDB answered HTTP ${status}`,
      });
    },
  );

  it("reports a network failure by its code, never fetch's message, which can quote the token", async () => {
    const client = new TmdbClient({
      fetch: () =>
        Promise.reject(
          new TypeError(`Bearer ${TOKEN} failed`, {
            cause: Object.assign(new Error("lookup"), { code: "ENOTFOUND" }),
          }),
        ),
      timeoutMs: 1_000,
    });

    await expect(client.checkKey(TOKEN)).resolves.toEqual({
      kind: "unreachable",
      reason: "TMDB request failed (ENOTFOUND)",
    });
  });

  it.each([
    ["a line break", "eyJ.token\nsig"],
    ["a space", "eyJ.token sig"],
    ["a smart quote", "eyJ.token“sig"],
  ])(
    "rejects a token with %s without calling TMDB, since it cannot be a header",
    async (_, token) => {
      const { fetch, calls } = answering(200);
      const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

      await expect(client.checkKey(token)).resolves.toEqual({
        kind: "rejected",
      });
      expect(calls).toEqual([]);
    },
  );

  it("reports a call that outlasts the timeout as unreachable", async () => {
    const client = new TmdbClient({ fetch: hanging, timeoutMs: 5 });

    await expect(client.checkKey(TOKEN)).resolves.toEqual({
      kind: "unreachable",
      reason: "TMDB did not answer within 5 ms",
    });
  });

  it("rethrows the caller's abort instead of reporting an outage", async () => {
    const client = new TmdbClient({ fetch: hanging, timeoutMs: 1_000 });
    const controller = new AbortController();
    const reason = new Error("scan cancelled");

    const check = client.checkKey(TOKEN, controller.signal);
    controller.abort(reason);

    await expect(check).rejects.toBe(reason);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses a timeout of %s", (timeoutMs) => {
    expect(() => new TmdbClient({ timeoutMs })).toThrow(/timeoutMs/);
  });
});

describe("TmdbClient.searchMovies", () => {
  it("searches by title and year hint and reads each result's first-release facts", async () => {
    const { fetch, urls } = routedFetch({
      "/3/search/movie": () =>
        Response.json({
          page: 1,
          results: [
            searchResult(348, "Alien", "1979-05-25"),
            searchResult(9, "Alien Hunt", "", null),
          ],
        }),
    });
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    await expect(
      client.searchMovies(TOKEN, { title: "Alien", year: 1979 }),
    ).resolves.toEqual({
      kind: "ok",
      value: [
        {
          id: 348,
          title: "Alien",
          releaseDate: "1979-05-25",
          posterPath: "/poster-348.jpg",
        },
        { id: 9, title: "Alien Hunt" },
      ],
    });
    expect(urls.map(String)).toEqual([
      "https://api.themoviedb.org/3/search/movie?query=Alien&include_adult=false&year=1979",
    ]);
  });

  it("omits the year when there is no year hint", async () => {
    const { fetch, urls } = routedFetch({
      "/3/search/movie": () => Response.json({ results: [] }),
    });
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    await client.searchMovies(TOKEN, { title: "The Thing & Co" });

    expect(urls[0]?.searchParams.get("query")).toBe("The Thing & Co");
    expect(urls[0]?.searchParams.has("year")).toBe(false);
  });

  it("reports a response it cannot read as a failure", async () => {
    const client = new TmdbClient({
      fetch: async () => Response.json({ results: [{ id: "x" }] }),
      timeoutMs: 1_000,
    });

    await expect(
      client.searchMovies(TOKEN, { title: "Alien" }),
    ).resolves.toEqual({
      kind: "failed",
      reason: "TMDB sent a response kraziTV could not read",
    });
  });

  it.each([401, 404, 500])(
    "reports HTTP %i as a failure naming the status",
    async (status) => {
      const client = new TmdbClient({
        fetch: answering(status).fetch,
        timeoutMs: 1_000,
      });

      await expect(
        client.searchMovies(TOKEN, { title: "Alien" }),
      ).resolves.toEqual({
        kind: "failed",
        reason: `TMDB answered HTTP ${status}`,
      });
    },
  );

  it("waits for TMDB's Retry-After and tries again after a 429", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const client = new TmdbClient({
        fetch: async () => {
          calls += 1;
          return calls === 1
            ? new Response(null, {
                status: 429,
                headers: { "retry-after": "2" },
              })
            : Response.json({ results: [] });
        },
        timeoutMs: 10_000,
      });

      const search = client.searchMovies(TOKEN, { title: "Alien" });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);

      await expect(search).resolves.toEqual({ kind: "ok", value: [] });
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after three retries, reporting the 429", async () => {
    let calls = 0;
    const client = new TmdbClient({
      fetch: async () => {
        calls += 1;
        return new Response(null, {
          status: 429,
          headers: { "retry-after": "0" },
        });
      },
      timeoutMs: 1_000,
    });

    await expect(
      client.searchMovies(TOKEN, { title: "Alien" }),
    ).resolves.toEqual({
      kind: "failed",
      reason: "TMDB answered HTTP 429",
    });
    expect(calls).toBe(4);
  });

  it("reports a 429 at once when TMDB asks for a wait longer than ten seconds", async () => {
    let calls = 0;
    const client = new TmdbClient({
      fetch: async () => {
        calls += 1;
        return new Response(null, {
          status: 429,
          headers: { "retry-after": "3600" },
        });
      },
      timeoutMs: 1_000,
    });

    await expect(
      client.searchMovies(TOKEN, { title: "Alien" }),
    ).resolves.toEqual({ kind: "failed", reason: "TMDB answered HTTP 429" });
    expect(calls).toBe(1);
  });

  it("reports a failed answer even when its body cannot be discarded", async () => {
    const client = new TmdbClient({
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              throw new Error("connection reset");
            },
          }),
          { status: 503 },
        ),
      timeoutMs: 1_000,
    });

    await expect(
      client.searchMovies(TOKEN, { title: "Alien" }),
    ).resolves.toEqual({ kind: "failed", reason: "TMDB answered HTTP 503" });
  });

  it("stops waiting out a 429 when the caller cancels", async () => {
    const client = new TmdbClient({
      fetch: async () =>
        new Response(null, { status: 429, headers: { "retry-after": "5" } }),
      timeoutMs: 1_000,
    });
    const controller = new AbortController();
    const reason = new Error("scan cancelled");

    const search = client.searchMovies(
      TOKEN,
      { title: "Alien" },
      controller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort(reason);

    await expect(search).rejects.toBe(reason);
  });

  it("rethrows the caller's abort instead of reporting an outage", async () => {
    const client = new TmdbClient({ fetch: hanging, timeoutMs: 1_000 });
    const controller = new AbortController();
    const reason = new Error("scan cancelled");

    const search = client.searchMovies(
      TOKEN,
      { title: "Alien" },
      controller.signal,
    );
    controller.abort(reason);

    await expect(search).rejects.toBe(reason);
  });
});

describe("TmdbClient request queue", () => {
  it("holds an in-flight slot until the response body finishes", async () => {
    const { fetch, releases, paths } = heldMovieFetch(true);
    const client = new TmdbClient({ fetch, timeoutMs: 10_000 });
    const searches = ["a", "b", "c", "d", "e", "f"].map((title) =>
      client.searchMovies(TOKEN, { title }),
    );
    await vi.waitFor(() => expect(paths).toHaveLength(5));
    expect(releases).toHaveLength(5);
    releases[0]?.();
    await vi.waitFor(() => expect(paths).toHaveLength(6));
    for (const release of releases) release();
    await expect(Promise.all(searches)).resolves.toHaveLength(6);
  });

  it("rethrows caller cancellation while reading a response body", async () => {
    const { fetch, paths } = heldMovieFetch(true);
    const client = new TmdbClient({ fetch, timeoutMs: 10_000 });
    const controller = new AbortController();
    const reason = new Error("scan cancelled during body read");
    const search = client.searchMovies(
      TOKEN,
      { title: "Alien" },
      controller.signal,
    );
    await vi.waitFor(() => expect(paths).toHaveLength(1));
    controller.abort(reason);
    await expect(search).rejects.toBe(reason);
  });

  it("checks a key ahead of lookups already waiting in line", async () => {
    const { fetch, releases, paths } = heldMovieFetch();
    const client = new TmdbClient({
      fetch,
      timeoutMs: 1_000,
    });

    const searches = ["a", "b", "c", "d", "e", "f"].map((title) =>
      client.searchMovies(TOKEN, { title }),
    );
    await vi.waitFor(() => expect(paths).toHaveLength(5));
    const check = client.checkKey(TOKEN);
    releases[0]?.();

    await expect(check).resolves.toEqual({ kind: "valid" });
    expect(paths.slice(5, 6)).toEqual(["/3/authentication"]);
    for (const release of releases) release();
    await vi.waitFor(() => expect(paths).toHaveLength(7));
    releases.at(-1)?.();
    await Promise.all(searches);
  });
});

describe("TmdbClient.movieDetails", () => {
  it("reads genres, franchise, description, poster, and runtime from a movie's details", async () => {
    const { fetch, urls } = routedFetch({
      "/3/movie/348": () => Response.json(ALIEN_DETAILS),
    });
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    await expect(client.movieDetails(TOKEN, 348)).resolves.toEqual({
      kind: "ok",
      value: {
        id: 348,
        title: "Alien",
        releaseDate: "1979-05-25",
        posterPath: "/alien.jpg",
        genres: ["Horror", "Science Fiction"],
        franchise: { id: 8091, name: "Alien Collection" },
        description:
          "During its return to the earth, commercial spaceship Nostromo…",
        runtimeMs: 117 * 60_000,
      },
    });
    expect(urls.map(String)).toEqual([
      "https://api.themoviedb.org/3/movie/348",
    ]);
  });

  it("leaves unknown facts absent rather than empty", async () => {
    const client = new TmdbClient({
      fetch: async () =>
        Response.json({
          id: 7,
          title: "Untitled",
          release_date: "",
          overview: "",
          poster_path: null,
          genres: [],
          belongs_to_collection: null,
          runtime: 0,
        }),
      timeoutMs: 1_000,
    });

    await expect(client.movieDetails(TOKEN, 7)).resolves.toEqual({
      kind: "ok",
      value: { id: 7, title: "Untitled", genres: [] },
    });
  });
});
