import { describe, expect, it, vi } from "vitest";

import { TmdbClient } from "../tmdb/tmdb-client.js";
import { hanging, routedFetch } from "../testing/tmdb-fetch.js";
import {
  FIREFLY,
  DOCTOR_WHO_1963,
  DOCTOR_WHO_2005,
  episode,
  seasonDetails,
  seriesDetails,
  seriesResult,
  tmdbSeries,
} from "../testing/tmdb-series.js";
import { lookUpEpisodes, lookUpEpisodesInSeries } from "./look-up-episodes.js";

const TOKEN = "eyJ.read-access-token.sig";

describe("lookUpEpisodes", () => {
  it("matches every episode in two seasons with one search and one fetch per season", async () => {
    const { client, urls } = tmdbSeries({ Firefly: [FIREFLY] });

    const lookups = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Firefly", strength: "strong" },
      [episode(1, 1), episode(1, 5), episode(2, 1)],
    );

    expect(lookups.map((lookup) => lookup.kind)).toEqual([
      "matched",
      "matched",
      "matched",
    ]);
    expect(lookups[1]).toMatchObject({
      query: { title: "Firefly" },
      series: { id: 1437, title: "Firefly", genres: ["Drama"] },
      season: 1,
      episodes: [{ number: 5, title: "Episode 1.5" }],
    });
    expect(urls.map((url) => url.pathname).sort()).toEqual([
      "/3/search/tv",
      "/3/tv/1437",
      "/3/tv/1437/season/1",
      "/3/tv/1437/season/2",
    ]);
  });

  it("leaves Doctor Who without a year ambiguous between both series that hold the episode", async () => {
    const { client, urls } = tmdbSeries({
      "Doctor Who": [DOCTOR_WHO_2005, DOCTOR_WHO_1963],
    });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Doctor Who", strength: "strong" },
      [episode(1, 1)],
    );

    expect(lookup).toMatchObject({ kind: "ambiguous" });
    expect(
      lookup?.kind === "ambiguous" &&
        lookup.candidates.map((candidate) => candidate.id),
    ).toEqual([57243, 121]);
    expect(urls.some((url) => url.pathname.includes("/season/"))).toBe(false);
  });

  it("matches the series whose first-air year agrees with the year hint", async () => {
    const { client } = tmdbSeries({
      "Doctor Who": [DOCTOR_WHO_1963, DOCTOR_WHO_2005],
    });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Doctor Who", year: 2005, strength: "strong" },
      [episode(1, 1)],
    );

    expect(lookup).toMatchObject({
      kind: "matched",
      query: { title: "Doctor Who", year: 2005 },
      series: { id: 57243 },
    });
  });

  it("never picks between same-named series by which one holds the episodes", async () => {
    const { client, urls } = tmdbSeries({
      "The Office": [
        {
          result: seriesResult(2996, "The Office", "2001-07-09"),
          episodeCounts: { 1: 6, 2: 6 },
        },
        {
          result: seriesResult(2316, "The Office", "2005-03-24"),
          episodeCounts: { 1: 6, 5: 28 },
        },
      ],
    });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "The Office", strength: "strong" },
      [episode(5, 1)],
    );

    // A scene-labelled UK special could look like a US season, so a wrong
    // match would be silent; the user chooses instead.
    expect(lookup).toMatchObject({
      kind: "ambiguous",
      candidates: [{ id: 2996 }, { id: 2316 }],
    });
    expect(urls.map((url) => url.pathname)).toEqual(["/3/search/tv"]);
  });

  it("rethrows a cancel only after every season request it started has settled", async () => {
    let releaseSeason2 = () => {};
    const season2Held = new Promise<void>((resolve) => {
      releaseSeason2 = resolve;
    });
    const { fetch, urls } = routedFetch({
      "/3/search/tv": () => Response.json({ results: [FIREFLY.result] }),
      "/3/tv/1437": () =>
        Response.json(seriesDetails(FIREFLY.result, FIREFLY.episodeCounts)),
      // Answers only once released, as a request already on the wire would.
      "/3/tv/1437/season/2": async () => {
        await season2Held;
        return Response.json(seasonDetails(2, 10));
      },
    });
    // Season 1 hangs until the cancel, then rejects at once.
    const client = new TmdbClient({
      fetch: (input, init) =>
        (input instanceof Request ? input.url : String(input)).endsWith(
          "/season/1",
        )
          ? hanging(input, init)
          : fetch(input),
      timeoutMs: 1_000,
    });
    const stop = new AbortController();
    let settled = false;
    const lookup = lookUpEpisodes(
      client,
      TOKEN,
      { title: "Firefly", strength: "strong" },
      [episode(1, 1), episode(2, 1)],
      stop.signal,
    ).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      if (!urls.some((url) => url.pathname.endsWith("/season/2"))) {
        throw new Error("season 2 not yet requested");
      }
    });

    stop.abort(new Error("cancelled"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    releaseSeason2();

    await expect(lookup).rejects.toThrow("cancelled");
  });

  it("stops before fetching seasons when the caller cancels during the series lookup", async () => {
    const { client, urls } = tmdbSeries({ Firefly: [FIREFLY] });
    const stop = new AbortController();
    stop.abort(new Error("cancelled"));

    await expect(
      lookUpEpisodes(
        client,
        TOKEN,
        { title: "Firefly", strength: "strong" },
        [episode(1, 1), episode(2, 1)],
        stop.signal,
      ),
    ).rejects.toThrow("cancelled");
    expect(urls).toEqual([]);
  });

  it("matches a season 0 hint against the series' specials", async () => {
    const { client, urls } = tmdbSeries({ Firefly: [FIREFLY] });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Firefly", strength: "strong" },
      [episode(0, 1)],
    );

    expect(lookup).toMatchObject({
      kind: "matched",
      season: 0,
      episodes: [{ number: 1 }],
    });
    expect(urls.map((url) => url.pathname)).toContain("/3/tv/1437/season/0");
  });

  it("keeps both episodes of a multi-episode file", async () => {
    const { client } = tmdbSeries({ Firefly: [FIREFLY] });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Firefly", strength: "strong" },
      [episode(1, 5, 6)],
    );

    expect(
      lookup?.kind === "matched" &&
        lookup.episodes.map((found) => found.number),
    ).toEqual([5, 6]);
  });

  it("offers the series for an episode it does not hold, matching its siblings", async () => {
    const { client, urls } = tmdbSeries({ Firefly: [FIREFLY] });

    const lookups = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Firefly", strength: "strong" },
      [episode(1, 14), episode(1, 15), episode(1, 14, 15), episode(7, 1)],
    );

    expect(lookups.map((lookup) => lookup.kind)).toEqual([
      "matched",
      "ambiguous",
      "ambiguous",
      "ambiguous",
    ]);
    expect(lookups[1]).toMatchObject({ candidates: [{ id: 1437 }] });
    // TMDB lists no season 7, so it is never fetched.
    expect(urls.map((url) => url.pathname)).not.toContain(
      "/3/tv/1437/season/7",
    );
  });

  it("reports no results as unmatched for every file", async () => {
    const { client } = tmdbSeries({});

    await expect(
      lookUpEpisodes(client, TOKEN, { title: "Nothing", strength: "strong" }, [
        episode(1, 1),
        episode(1, 2),
      ]),
    ).resolves.toEqual([
      { kind: "unmatched", query: { title: "Nothing" } },
      { kind: "unmatched", query: { title: "Nothing" } },
    ]);
  });

  it("reports a failed search as a lookup failure for every file", async () => {
    const client = new TmdbClient({
      fetch: async () => new Response(null, { status: 503 }),
      timeoutMs: 1_000,
    });

    await expect(
      lookUpEpisodes(client, TOKEN, { title: "Firefly", strength: "strong" }, [
        episode(1, 1),
      ]),
    ).resolves.toEqual([
      {
        kind: "failed",
        query: { title: "Firefly" },
        reason: "TMDB answered HTTP 503",
      },
    ]);
  });

  it("fails only the files of a season whose fetch failed", async () => {
    const { fetch } = routedFetch({
      "/3/search/tv": () => Response.json({ results: [FIREFLY.result] }),
      "/3/tv/1437": () =>
        Response.json({
          ...FIREFLY.result,
          genres: [],
          seasons: [
            { season_number: 1, episode_count: 14 },
            { season_number: 2, episode_count: 10 },
          ],
        }),
      "/3/tv/1437/season/1": () =>
        Response.json({
          season_number: 1,
          episodes: [{ episode_number: 1, name: "Serenity" }],
        }),
      "/3/tv/1437/season/2": () => new Response(null, { status: 500 }),
    });
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    const lookups = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Firefly", strength: "strong" },
      [episode(1, 1), episode(2, 1)],
    );

    expect(lookups).toMatchObject([
      { kind: "matched" },
      { kind: "failed", reason: "TMDB answered HTTP 500" },
    ]);
  });

  it("never matches from weak hints", async () => {
    const { client, urls } = tmdbSeries({ Firefly: [FIREFLY] });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Firefly", strength: "weak" },
      [episode(1, 1)],
    );

    expect(lookup).toMatchObject({
      kind: "ambiguous",
      candidates: [{ id: 1437 }],
    });
    expect(urls).toHaveLength(1);
  });
});

describe("lookUpEpisodesInSeries", () => {
  it("reads a chosen series without searching, keeping the folder's query as evidence", async () => {
    const { client, urls } = tmdbSeries({
      "Doctor Who": [DOCTOR_WHO_1963, DOCTOR_WHO_2005],
    });

    const lookups = await lookUpEpisodesInSeries(
      client,
      TOKEN,
      57243,
      { title: "Doctor Who" },
      [episode(1, 1), episode(2, 14), episode(2, 15)],
    );

    expect(lookups).toMatchObject([
      { kind: "matched", query: { title: "Doctor Who" }, season: 1 },
      { kind: "matched", season: 2, episodes: [{ number: 14 }] },
      { kind: "ambiguous", candidates: [{ id: 57243 }] },
    ]);
    expect(urls.map((url) => url.pathname).sort()).toEqual([
      "/3/tv/57243",
      "/3/tv/57243/season/1",
      "/3/tv/57243/season/2",
    ]);
  });
});
