import { describe, expect, it } from "vitest";

import { TmdbClient } from "./tmdb-client.js";
import { routedFetch } from "../testing/tmdb-fetch.js";
import {
  seasonDetails,
  seriesDetails,
  seriesResult,
} from "../testing/tmdb-series.js";

const TOKEN = "eyJ.read-access-token.sig";

describe("TmdbClient.searchSeries", () => {
  it("searches by name and first-air year and reads each result's name and first air date", async () => {
    const { fetch, urls } = routedFetch({
      "/3/search/tv": () =>
        Response.json({
          page: 1,
          results: [
            seriesResult(57243, "Doctor Who", "2005-03-26"),
            seriesResult(9, "Doctor Who Extra", "", null),
          ],
        }),
    });
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    await expect(
      client.searchSeries(TOKEN, { title: "Doctor Who", year: 2005 }),
    ).resolves.toEqual({
      kind: "ok",
      value: [
        {
          id: 57243,
          title: "Doctor Who",
          releaseDate: "2005-03-26",
          posterPath: "/poster-57243.jpg",
        },
        { id: 9, title: "Doctor Who Extra" },
      ],
    });
    expect(urls.map(String)).toEqual([
      "https://api.themoviedb.org/3/search/tv?query=Doctor+Who&include_adult=false&first_air_date_year=2005",
    ]);
  });

  it("omits the year when there is no year hint", async () => {
    const { fetch, urls } = routedFetch({
      "/3/search/tv": () => Response.json({ results: [] }),
    });
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    await client.searchSeries(TOKEN, { title: "Firefly" });

    expect(urls[0]?.searchParams.has("first_air_date_year")).toBe(false);
  });

  it("reports a movie-shaped result it cannot read as a failure", async () => {
    const client = new TmdbClient({
      fetch: async () =>
        Response.json({ results: [{ id: 1, title: "Not a series" }] }),
      timeoutMs: 1_000,
    });

    await expect(
      client.searchSeries(TOKEN, { title: "Firefly" }),
    ).resolves.toEqual({
      kind: "failed",
      reason: "TMDB sent a response kraziTV could not read",
    });
  });
});

describe("TmdbClient.seriesDetails", () => {
  it("reads genres, description, poster, and each season's episode count", async () => {
    const firefly = seriesResult(1437, "Firefly", "2002-09-20", "/firefly.jpg");
    const { fetch, urls } = routedFetch({
      "/3/tv/1437": () =>
        Response.json(seriesDetails(firefly, { 0: 1, 1: 14 })),
    });
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    await expect(client.seriesDetails(TOKEN, 1437)).resolves.toEqual({
      kind: "ok",
      value: {
        id: 1437,
        title: "Firefly",
        releaseDate: "2002-09-20",
        posterPath: "/firefly.jpg",
        genres: ["Drama"],
        description: "About Firefly",
        seasons: [
          { number: 0, episodeCount: 1 },
          { number: 1, episodeCount: 14 },
        ],
      },
    });
    expect(urls.map(String)).toEqual(["https://api.themoviedb.org/3/tv/1437"]);
  });

  it("reports details without a season list as unreadable", async () => {
    const client = new TmdbClient({
      fetch: async () =>
        Response.json({ id: 1437, name: "Firefly", genres: [] }),
      timeoutMs: 1_000,
    });

    await expect(client.seriesDetails(TOKEN, 1437)).resolves.toMatchObject({
      kind: "failed",
    });
  });
});

describe("TmdbClient.seasonDetails", () => {
  it("reads each episode's number, title, air date, and description", async () => {
    const { fetch, urls } = routedFetch({
      "/3/tv/1437/season/1": () => Response.json(seasonDetails(1, 2)),
    });
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    await expect(client.seasonDetails(TOKEN, 1437, 1)).resolves.toEqual({
      kind: "ok",
      value: {
        number: 1,
        episodes: [
          {
            number: 1,
            title: "Episode 1.1",
            airDate: "2002-09-01",
            description: "What happens in 1.1",
          },
          {
            number: 2,
            title: "Episode 1.2",
            airDate: "2002-09-02",
            description: "What happens in 1.2",
          },
        ],
      },
    });
    expect(urls.map(String)).toEqual([
      "https://api.themoviedb.org/3/tv/1437/season/1",
    ]);
  });

  it("leaves an episode's unknown facts absent rather than empty", async () => {
    const client = new TmdbClient({
      fetch: async () =>
        Response.json({
          season_number: 0,
          episodes: [
            { episode_number: 1, name: "", air_date: null, overview: "" },
          ],
        }),
      timeoutMs: 1_000,
    });

    await expect(client.seasonDetails(TOKEN, 1437, 0)).resolves.toEqual({
      kind: "ok",
      value: { number: 0, episodes: [{ number: 1 }] },
    });
  });
});
