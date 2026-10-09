import { describe, expect, it } from "vitest";

import { TmdbClient } from "../tmdb/tmdb-client.js";
import { searchResult, tmdb } from "../testing/tmdb-movies.js";
import { lookUpMovie } from "./look-up-movie.js";

const TOKEN = "eyJ.read-access-token.sig";

describe("lookUpMovie", () => {
  it("matches Alien (1979) and reads its details", async () => {
    const { client, urls } = tmdb({
      Alien: [searchResult(348, "Alien", "1979-05-25")],
    });

    const lookup = await lookUpMovie(client, TOKEN, {
      title: "Alien",
      year: 1979,
      strength: "strong",
    });

    expect(lookup).toMatchObject({
      kind: "matched",
      query: { title: "Alien", year: 1979 },
      movie: {
        id: 348,
        genres: ["Horror", "Science Fiction"],
        franchise: { id: 8091, name: "Alien Collection" },
      },
    });
    expect(urls.map((url) => url.pathname)).toEqual([
      "/3/search/movie",
      "/3/movie/348",
    ]);
  });

  it("leaves The Thing ambiguous among its three releases without reading details", async () => {
    const { client, urls } = tmdb({
      "The Thing": [
        searchResult(1091, "The Thing", "1982-06-25"),
        searchResult(60935, "The Thing", "2011-10-12"),
        searchResult(10785, "The Thing", "1951-04-06"),
      ],
    });

    const lookup = await lookUpMovie(client, TOKEN, {
      title: "The Thing",
      strength: "strong",
    });

    expect(lookup).toMatchObject({ kind: "ambiguous" });
    expect(
      lookup.kind === "ambiguous" && lookup.candidates.map((movie) => movie.id),
    ).toEqual([1091, 60935, 10785]);
    expect(urls).toHaveLength(1);
  });

  it("searches once more with a trailing year split off when the whole name finds nothing", async () => {
    const { client, urls } = tmdb({
      Gladiator: [searchResult(98, "Gladiator", "2000-05-01")],
    });

    const lookup = await lookUpMovie(client, TOKEN, {
      title: "Gladiator 2000",
      strength: "strong",
    });

    expect(lookup).toMatchObject({
      kind: "matched",
      query: { title: "Gladiator", year: 2000 },
      movie: { id: 98 },
    });
    expect(
      urls.map((url) => [
        url.pathname,
        url.searchParams.get("query"),
        url.searchParams.get("year"),
      ]),
    ).toEqual([
      ["/3/search/movie", "Gladiator 2000", null],
      ["/3/search/movie", "Gladiator", "2000"],
      ["/3/movie/98", null, null],
    ]);
  });

  it("keeps a title that ends in a number when its first search finds it", async () => {
    const { client, urls } = tmdb({
      "Blade Runner 2049": [
        searchResult(335984, "Blade Runner 2049", "2017-10-04"),
      ],
    });

    const lookup = await lookUpMovie(client, TOKEN, {
      title: "Blade Runner 2049",
      strength: "strong",
    });

    expect(lookup).toMatchObject({
      kind: "matched",
      query: { title: "Blade Runner 2049" },
      movie: { id: 335984 },
    });
    expect(urls.map((url) => url.pathname)).toEqual([
      "/3/search/movie",
      "/3/movie/335984",
    ]);
  });

  it("does not split a year when the hints already carry one", async () => {
    const { client, urls } = tmdb({});

    await expect(
      lookUpMovie(client, TOKEN, {
        title: "Gladiator 2000",
        year: 2000,
        strength: "strong",
      }),
    ).resolves.toMatchObject({ kind: "unmatched" });
    expect(urls).toHaveLength(1);
  });

  it("reports a failed search as a lookup failure", async () => {
    const client = new TmdbClient({
      fetch: async () => new Response(null, { status: 503 }),
      timeoutMs: 1_000,
    });

    await expect(
      lookUpMovie(client, TOKEN, { title: "Alien", strength: "strong" }),
    ).resolves.toEqual({
      kind: "failed",
      query: { title: "Alien" },
      reason: "TMDB answered HTTP 503",
    });
  });
});
