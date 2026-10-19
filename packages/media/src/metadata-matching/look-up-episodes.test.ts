import { describe, expect, it, vi } from "vitest";

import { TmdbClient } from "../tmdb/tmdb-client.js";
import { hanging, routedFetch } from "../testing/tmdb-fetch.js";
import {
  FIREFLY,
  DOCTOR_WHO_1963,
  DOCTOR_WHO_2005,
  absoluteEpisode,
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
    // Both list season 1 with its first episode, so both details are read
    // but no season is.
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

  it("tells same-named series apart by which one lists the folder's seasons", async () => {
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

    const lookups = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "The Office", strength: "strong" },
      [episode(1, 1), episode(5, 1)],
    );

    // Only the US series has a season 5; that decides both files.
    expect(lookups).toMatchObject([
      { kind: "matched", series: { id: 2316 }, season: 1 },
      { kind: "matched", series: { id: 2316 }, season: 5 },
    ]);
    expect(urls.map((url) => url.pathname)).toEqual([
      "/3/search/tv",
      "/3/tv/2996",
      "/3/tv/2316",
      "/3/tv/2316/season/1",
      "/3/tv/2316/season/5",
    ]);
  });

  it("tells same-named series listing the same seasons apart by episode count", async () => {
    const { client } = tmdbSeries({
      Survivor: [
        {
          result: seriesResult(1, "Survivor", "2000-05-31"),
          episodeCounts: { 1: 16 },
        },
        {
          result: seriesResult(2, "Survivor", "2003-01-01"),
          episodeCounts: { 1: 8 },
        },
      ],
    });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Survivor", strength: "strong" },
      [episode(1, 12)],
    );

    expect(lookup).toMatchObject({ kind: "matched", series: { id: 1 } });
  });

  it("searches again without the year when the dated result does not hold the folder", async () => {
    const miniseries = {
      result: seriesResult(71365, "Battlestar Galactica", "2003-12-08"),
      episodeCounts: { 1: 2 },
    };
    const series = {
      result: seriesResult(1972, "Battlestar Galactica", "2004-10-18"),
      episodeCounts: { 1: 13, 2: 20 },
    };
    const classic = {
      result: seriesResult(501, "Battlestar Galactica", "1978-09-17"),
      episodeCounts: { 1: 24 },
    };
    const { fetch, urls } = routedFetch({
      "/3/search/tv": (url) =>
        Response.json({
          results:
            url.searchParams.get("first_air_date_year") === "2003"
              ? [miniseries.result]
              : [series.result, classic.result, miniseries.result],
        }),
      "/3/tv/71365": () =>
        Response.json(
          seriesDetails(miniseries.result, miniseries.episodeCounts),
        ),
      "/3/tv/1972": () =>
        Response.json(seriesDetails(series.result, series.episodeCounts)),
      "/3/tv/501": () =>
        Response.json(seriesDetails(classic.result, classic.episodeCounts)),
      "/3/tv/1972/season/2": () => Response.json(seasonDetails(2, 20)),
    });
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Battlestar Galactica", year: 2003, strength: "strong" },
      [episode(2, 17)],
    );

    // The folder's own seasons outweigh TMDB dating the series a year later;
    // the undated query is the evidence that found it.
    expect(lookup).toMatchObject({
      kind: "matched",
      query: { title: "Battlestar Galactica" },
      series: { id: 1972 },
      episodes: [{ number: 17 }],
    });
    expect(
      urls
        .filter((url) => url.pathname === "/3/search/tv")
        .map((url) => url.searchParams.get("first_air_date_year")),
    ).toEqual(["2003", null]);
  });

  it("searches again without a year that finds nothing", async () => {
    const mrRobot = {
      result: seriesResult(62560, "Mr. Robot", "2015-06-24"),
      episodeCounts: { 1: 10 },
    };
    const { client, urls } = tmdbSeries({ "Mr Robot": [mrRobot] });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Mr Robot", year: 2022, strength: "strong" },
      [episode(1, 1)],
    );

    expect(lookup).toMatchObject({
      kind: "matched",
      query: { title: "Mr Robot" },
      series: { id: 62560 },
    });
    expect(
      urls
        .filter((url) => url.pathname === "/3/search/tv")
        .map((url) => url.searchParams.get("first_air_date_year")),
    ).toEqual(["2022", null]);
  });

  it("only offers a result with another title, however well it holds the folder", async () => {
    const { client, urls } = tmdbSeries({
      "Mr Robot": [FIREFLY],
      Serenity: [FIREFLY],
    });

    const lookups = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Serenity", strength: "strong" },
      [episode(1, 1), episode(2, 1)],
    );
    const detailReadsBefore = urls.filter((url) =>
      url.pathname.startsWith("/3/tv/"),
    ).length;
    const [dated] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Mr Robot", year: 2002, strength: "strong" },
      [episode(5, 1)],
    );
    const [datedAndHeld] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Mr Robot", year: 2002, strength: "strong" },
      [episode(1, 1)],
    );

    // Firefly lists both seasons, but it is not what the folder names, so
    // without a year it is only offered and no details are read.
    expect(lookups).toMatchObject([
      { kind: "ambiguous", candidates: [{ id: 1437 }] },
      { kind: "ambiguous", candidates: [{ id: 1437 }] },
    ]);
    expect(detailReadsBefore).toBe(0);
    // The lone result of the hinted year is checked, and is the series only
    // when it holds the folder.
    expect(dated).toMatchObject({
      kind: "ambiguous",
      candidates: [{ id: 1437 }],
    });
    expect(datedAndHeld).toMatchObject({
      kind: "matched",
      series: { id: 1437 },
    });
  });

  it("leaves more than ten same-titled results to the owner without reading any", async () => {
    const namesakes = Array.from({ length: 11 }, (_, index) => ({
      result: seriesResult(100 + index, "Twins", `${1990 + index}-01-01`),
      episodeCounts: { 1: 10 },
    }));
    const { client, urls } = tmdbSeries({ Twins: namesakes });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Twins", strength: "strong" },
      [episode(1, 1)],
    );

    expect(lookup?.kind === "ambiguous" && lookup.candidates).toHaveLength(11);
    expect(urls.map((url) => url.pathname)).toEqual(["/3/search/tv"]);
  });

  it("rethrows a cancel during the candidate reads only after they have settled", async () => {
    let releaseSecond = () => {};
    const secondHeld = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const { fetch, urls } = routedFetch({
      "/3/search/tv": () =>
        Response.json({
          results: [DOCTOR_WHO_2005.result, DOCTOR_WHO_1963.result],
        }),
      "/3/tv/121": async () => {
        await secondHeld;
        return Response.json(
          seriesDetails(DOCTOR_WHO_1963.result, DOCTOR_WHO_1963.episodeCounts),
        );
      },
    });
    const client = new TmdbClient({
      fetch: (input, init) =>
        (input instanceof Request ? input.url : String(input)).endsWith(
          "/tv/57243",
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
      { title: "Doctor Who", strength: "strong" },
      [episode(1, 1)],
      stop.signal,
    ).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      if (!urls.some((url) => url.pathname.endsWith("/tv/121"))) {
        throw new Error("second candidate not yet requested");
      }
    });

    stop.abort(new Error("cancelled"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    releaseSecond();

    await expect(lookup).rejects.toThrow("cancelled");
    expect(urls.some((url) => url.pathname.includes("/season/"))).toBe(false);
  });

  it("stays unmatched when neither search finds the title", async () => {
    const { client, urls } = tmdbSeries({});

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Nothing", year: 2022, strength: "strong" },
      [episode(1, 1)],
    );

    expect(lookup).toEqual({
      kind: "unmatched",
      query: { title: "Nothing", year: 2022 },
    });
    expect(urls).toHaveLength(2);
  });

  it("matches the lone dated result of a title TMDB spells differently", async () => {
    const { client } = tmdbSeries({
      Shameless: [
        {
          result: seriesResult(34307, "Shameless", "2011-01-09"),
          episodeCounts: { 1: 12 },
        },
      ],
    });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Shameless", country: "US", year: 2011, strength: "strong" },
      [episode(1, 1)],
    );

    expect(lookup).toMatchObject({ kind: "matched", series: { id: 34307 } });
  });

  it("places an episode numbered through the whole series in the season it lands in", async () => {
    const bleach = {
      result: seriesResult(30984, "Bleach", "2004-10-05"),
      episodeCounts: { 0: 3, 1: 20, 2: 21, 3: 22 },
    };
    const { client, urls } = tmdbSeries({ Bleach: [bleach] });

    const lookups = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Bleach", strength: "strong" },
      [episode(3, 50), episode(3, 45), absoluteEpisode(21), episode(1, 5)],
    );

    // Every season 3 file is numbered past its 22 episodes, and 45 and 50
    // both count past seasons 1 and 2 into season 3, so the folder counts
    // that season through the series; 21 without a season is season 2's
    // first episode; 5 is listed in season 1 as itself.
    expect(lookups).toMatchObject([
      { kind: "matched", season: 3, episode: { first: 9, last: 9 } },
      { kind: "matched", season: 3, episode: { first: 4, last: 4 } },
      { kind: "matched", season: 2, episode: { first: 1, last: 1 } },
      { kind: "matched", season: 1, episode: { first: 5, last: 5 } },
    ]);
    expect(urls.map((url) => url.pathname).sort()).toEqual([
      "/3/search/tv",
      "/3/tv/30984",
      "/3/tv/30984/season/1",
      "/3/tv/30984/season/2",
      "/3/tv/30984/season/3",
    ]);
  });

  it("reads one file numbered just past a season's end as unlisted, not as counting from the start", async () => {
    const { client } = tmdbSeries({
      "Doctor Who": [DOCTOR_WHO_2005],
    });

    const lookups = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Doctor Who", strength: "strong" },
      [episode(2, 1), episode(2, 15)],
    );

    // Season 2 lists 14 episodes, and 15 would count to its second; but the
    // folder also holds episode 1, so it is numbered by season, and TMDB
    // simply disagrees about the last episode.
    expect(lookups).toMatchObject([
      { kind: "matched", season: 2, episodes: [{ number: 1 }] },
      { kind: "matched", season: 2, episode: { first: 15 }, episodes: [] },
    ]);
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

  it("matches an episode the series does not list to the series, keeping the file's numbers", async () => {
    const { client, urls } = tmdbSeries({ Firefly: [FIREFLY] });

    const lookups = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Firefly", strength: "strong" },
      [episode(1, 14), episode(1, 15), episode(1, 14, 15), episode(7, 1)],
    );

    // Season 1 ends at 14, and 15 counts to season 2's first episode, which
    // is not season 1, so it stays as the file names it; so does season 7.
    expect(lookups).toMatchObject([
      { kind: "matched", season: 1, episodes: [{ number: 14 }] },
      { kind: "matched", season: 1, episode: { first: 15 }, episodes: [] },
      {
        kind: "matched",
        season: 1,
        episode: { first: 14, last: 15 },
        episodes: [],
      },
      { kind: "matched", season: 7, episode: { first: 1 }, episodes: [] },
    ]);
    // TMDB lists no season 7, so it is never fetched.
    expect(urls.map((url) => url.pathname)).not.toContain(
      "/3/tv/1437/season/7",
    );
  });

  it("leaves an episode numbered past the series' last with no season", async () => {
    const { client } = tmdbSeries({ Firefly: [FIREFLY] });

    const [lookup] = await lookUpEpisodes(
      client,
      TOKEN,
      { title: "Firefly", strength: "strong" },
      [absoluteEpisode(99)],
    );

    expect(lookup).toMatchObject({
      kind: "matched",
      season: null,
      episode: { first: 99, last: 99 },
      episodes: [],
    });
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
  it("re-reads a stored place as stored, never re-placing one file by the folder rule", async () => {
    const { client } = tmdbSeries({ "Doctor Who": [DOCTOR_WHO_2005] });

    const [stored] = await lookUpEpisodesInSeries(
      client,
      TOKEN,
      57243,
      { title: "Doctor Who" },
      [episode(2, 15)],
      undefined,
      { countThroughSeries: false },
    );
    const [alone] = await lookUpEpisodesInSeries(
      client,
      TOKEN,
      57243,
      { title: "Doctor Who" },
      [episode(2, 15)],
    );

    // A refresh keeps an unlisted S02E15 as it was stored; read as a folder
    // of one, the same number would count to season 2's second episode.
    expect(stored).toMatchObject({
      kind: "matched",
      season: 2,
      episode: { first: 15 },
      episodes: [],
    });
    expect(alone).toMatchObject({
      kind: "matched",
      season: 2,
      episode: { first: 2 },
      episodes: [{ number: 2 }],
    });
  });

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
      { kind: "matched", season: 2, episode: { first: 15 }, episodes: [] },
    ]);
    expect(urls.map((url) => url.pathname).sort()).toEqual([
      "/3/tv/57243",
      "/3/tv/57243/season/1",
      "/3/tv/57243/season/2",
    ]);
  });
});
