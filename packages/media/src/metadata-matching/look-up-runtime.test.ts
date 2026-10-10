import { describe, expect, it } from "vitest";

import { TmdbClient } from "../tmdb/tmdb-client.js";
import { searchResult, tmdb } from "../testing/tmdb-movies.js";
import { routedFetch } from "../testing/tmdb-fetch.js";
import { episode, FIREFLY, tmdbSeries } from "../testing/tmdb-series.js";
import { lookUpRuntimeMs } from "./look-up-runtime.js";

const TOKEN = "eyJ.read-access-token.sig";

describe("lookUpRuntimeMs", () => {
  it("reads a movie's runtime from its details", async () => {
    const { client } = tmdb({ Alien: [searchResult(348, "Alien", "1979")] });

    await expect(
      lookUpRuntimeMs(client, TOKEN, { kind: "movie", id: 348 }),
    ).resolves.toBe(117 * 60_000);
  });

  it("sums a multi-episode file's episodes from one season fetch", async () => {
    const { client, urls } = tmdbSeries({ Firefly: [FIREFLY] });

    await expect(
      lookUpRuntimeMs(client, TOKEN, {
        kind: "series",
        id: 1437,
        episode: episode(1, 5, 6),
      }),
    ).resolves.toBe(2 * 44 * 60_000);
    expect(urls.map((url) => url.pathname)).toEqual(["/3/tv/1437/season/1"]);
  });

  it("is unknown when the series lacks an episode or TMDB fails", async () => {
    const { client } = tmdbSeries({ Firefly: [FIREFLY] });
    const failing = new TmdbClient({
      fetch: routedFetch({}).fetch,
      timeoutMs: 1_000,
    });

    await expect(
      lookUpRuntimeMs(client, TOKEN, {
        kind: "series",
        id: 1437,
        episode: episode(1, 14, 15),
      }),
    ).resolves.toBeUndefined();
    await expect(
      lookUpRuntimeMs(failing, TOKEN, { kind: "movie", id: 348 }),
    ).resolves.toBeUndefined();
  });
});
