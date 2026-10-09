import { afterEach, describe, expect, it } from "vitest";

import { rootFixture } from "../../testing/catalog-fixtures.js";
import {
  matchDecisions,
  scanToEnd,
  setupEnrichmentScan,
  waitForScanEnd,
} from "../../testing/enrichment-scan.js";
import { createBarrier } from "../../testing/test-barrier.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

describe("CatalogScanner enrichment", () => {
  it("looks movies up between probing and committing: Alien matches, The Thing stays ambiguous", async () => {
    const context = await setupEnrichmentScan({
      files: ["Alien (1979)/movie.mkv", "The Thing/movie.mkv"],
    });
    const held = createBarrier();
    context.tmdb.holds.set("/3/search/movie", held);

    const started = await context.scanner.start(rootFixture.id);
    await held.reached;
    expect(context.scanner.status(rootFixture.id)).toMatchObject({
      phase: "enriching",
      lookupCount: 2,
      lookedUpCount: 0,
    });
    held.release();
    const status = await waitForScanEnd(context);

    expect(started.kind).toBe("started");
    expect(status).toMatchObject({
      phase: "completed",
      lookedUpCount: 2,
      currentTitle: null,
      summary: {
        matchedCount: 1,
        ambiguousCount: 1,
        unmatchedCount: 0,
        lookupErrorCount: 0,
      },
    });
    await expect(matchDecisions(context)).resolves.toEqual([
      {
        file: "Alien (1979)/movie.mkv",
        state: "matched",
        extra: false,
        lookupError: null,
      },
      {
        file: "The Thing/movie.mkv",
        state: "ambiguous",
        extra: false,
        lookupError: null,
      },
    ]);
    await expect(
      context.db
        .selectFrom("content_facts")
        .select(["title", "genres"])
        .execute(),
    ).resolves.toEqual([{ title: "Alien", genres: '["Horror"]' }]);
  });

  it("makes no TMDB call and records no lookup without a key", async () => {
    const context = await setupEnrichmentScan({
      key: false,
      files: ["Alien (1979)/movie.mkv"],
    });

    const status = await scanToEnd(context);

    expect(status).toMatchObject({
      phase: "completed",
      lookupCount: 0,
      summary: { matchedCount: 0, lookupErrorCount: 0 },
    });
    expect(context.tmdb.requests).toEqual([]);
    await expect(matchDecisions(context)).resolves.toEqual([]);
  });

  it("makes no TMDB call when rescanning a matched and an ambiguous item", async () => {
    const context = await setupEnrichmentScan({
      files: ["Alien (1979)/movie.mkv", "The Thing/movie.mkv"],
    });
    await scanToEnd(context);
    const calls = context.tmdb.requests.length;

    const rescan = await scanToEnd(context);

    expect(context.tmdb.requests).toHaveLength(calls);
    expect(rescan).toMatchObject({ phase: "completed", lookupCount: 0 });
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "matched" },
      { state: "ambiguous" },
    ]);
  });

  it("searches a title and year once for every file that shares it", async () => {
    const context = await setupEnrichmentScan({
      files: ["Alien (1979)/movie.mkv", "Alien (1979)/alien.mkv"],
    });

    const status = await scanToEnd(context);

    expect(context.tmdb.paths()).toEqual([
      "/3/authentication",
      "/3/search/movie",
      "/3/movie/348",
    ]);
    expect(status).toMatchObject({
      lookedUpCount: 2,
      summary: { matchedCount: 2 },
    });
  });

  it("finds Gladiator.2000.mkv on a second search with the year split off", async () => {
    const context = await setupEnrichmentScan({
      files: ["Gladiator.2000.mkv"],
    });
    context.tmdb.movies.push({
      id: 98,
      title: "Gladiator",
      releaseDate: "2000-05-01",
    });

    await scanToEnd(context);

    expect(
      context.tmdb.requests.map((url) => url.searchParams.get("query")),
    ).toEqual([null, "Gladiator 2000", "Gladiator", null]);
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "matched" },
    ]);
  });

  it("retries a lookup TMDB answers with 429", async () => {
    const context = await setupEnrichmentScan({
      files: ["Alien (1979)/movie.mkv"],
    });
    context.tmdb.forcedStatuses.push(429);

    await scanToEnd(context);

    expect(context.tmdb.paths()).toEqual([
      "/3/authentication",
      "/3/search/movie",
      "/3/search/movie",
      "/3/movie/348",
    ]);
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "matched" },
    ]);
  });

  it("records a lookup error after a fourth 429", async () => {
    const context = await setupEnrichmentScan({
      files: ["Alien (1979)/movie.mkv"],
    });
    context.tmdb.forcedStatuses.push(429, 429, 429, 429);

    const status = await scanToEnd(context);

    expect(status).toMatchObject({ summary: { lookupErrorCount: 1 } });
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "unmatched", lookupError: "TMDB answered HTTP 429" },
    ]);
  });

  it("checks a saved key once and records a rejected key without searching", async () => {
    const context = await setupEnrichmentScan({
      files: ["Alien (1979)/movie.mkv", "The Thing/movie.mkv"],
    });
    context.tmdb.validKeys.clear();

    const status = await scanToEnd(context);

    expect(context.tmdb.paths()).toEqual(["/3/authentication"]);
    expect(status).toMatchObject({
      phase: "completed",
      summary: { lookupErrorCount: 2 },
    });
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "unmatched", lookupError: "TMDB rejected the key" },
      { state: "unmatched", lookupError: "TMDB rejected the key" },
    ]);
  });

  it("fails the scan on an unexpected lookup error only after every lookup settles, committing nothing", async () => {
    const context = await setupEnrichmentScan({
      files: ["Alien (1979)/movie.mkv", "The Thing/movie.mkv"],
      tmdb: (client) => ({
        checkKey: client.checkKey.bind(client),
        movieDetails: client.movieDetails.bind(client),
        searchMovies: async (key, query, signal) => {
          if (query.title === "Alien") throw new Error("boom");
          return client.searchMovies(key, query, signal);
        },
      }),
    });

    const status = await scanToEnd(context);

    expect(status).toMatchObject({
      phase: "failed",
      error: { code: "scan_failed" },
    });
    await expect(
      context.db.selectFrom("media_items").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("records a failed lookup per item and keeps the item available", async () => {
    const context = await setupEnrichmentScan({
      files: ["Alien (1979)/movie.mkv"],
    });
    context.tmdb.unreachable = true;

    const status = await scanToEnd(context);

    expect(status).toMatchObject({
      phase: "completed",
      summary: { lookupErrorCount: 1, probeFailedCount: 0 },
    });
    await expect(matchDecisions(context)).resolves.toEqual([
      {
        file: "Alien (1979)/movie.mkv",
        state: "unmatched",
        extra: false,
        lookupError: "TMDB request failed",
      },
    ]);
    await expect(
      context.db.selectFrom("media_items").select("status").execute(),
    ).resolves.toEqual([{ status: "available" }]);
  });

  it("looks a failed lookup up again on the next scan", async () => {
    const context = await setupEnrichmentScan({
      files: ["Alien (1979)/movie.mkv"],
    });
    context.tmdb.unreachable = true;
    await scanToEnd(context);
    context.tmdb.unreachable = false;

    await scanToEnd(context);

    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "matched", lookupError: null },
    ]);
  });

  it("records an extra without a lookup, and skips failed probes", async () => {
    const context = await setupEnrichmentScan({
      files: [
        "Alien (1979)/Featurettes/making-of.mkv",
        "Broken (2001)/movie.mkv",
      ],
      probeFailures: ["Broken (2001)/movie.mkv"],
    });

    const status = await scanToEnd(context);

    expect(context.tmdb.requests).toEqual([]);
    expect(status).toMatchObject({ phase: "completed", lookupCount: 0 });
    await expect(matchDecisions(context)).resolves.toEqual([
      {
        file: "Alien (1979)/Featurettes/making-of.mkv",
        state: "unmatched",
        extra: true,
        lookupError: null,
      },
    ]);
  });

  it("cancels during enriching only after every started lookup settles, committing nothing", async () => {
    const context = await setupEnrichmentScan({
      files: ["Alien (1979)/movie.mkv", "The Thing/movie.mkv"],
    });
    const held = createBarrier();
    context.tmdb.holds.set("/3/search/movie", held);
    await context.scanner.start(rootFixture.id);
    await held.reached;

    expect(context.scanner.cancel(rootFixture.id)).toMatchObject({
      phase: "enriching",
      cancelRequested: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(context.scanner.status(rootFixture.id)?.phase).toBe("enriching");
    held.release();
    const status = await waitForScanEnd(context);

    expect(status.phase).toBe("cancelled");
    expect(context.tmdb.paths()).toEqual([
      "/3/authentication",
      "/3/search/movie",
      "/3/search/movie",
    ]);
    await expect(
      context.db.selectFrom("media_items").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(matchDecisions(context)).resolves.toEqual([]);
  });
});
