import { join, resolve } from "node:path";

import { TmdbClient } from "@krazitv/media";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MetadataMatchRepository } from "../../content-metadata/metadata-match-repository.js";
import { TmdbKeyService } from "../../content-metadata/tmdb-key-service.js";
import { MediaRootRepository } from "../../media-roots/media-root-repository.js";
import { rootFixture } from "../../testing/catalog-fixtures.js";
import {
  SCAN_ALIEN as ALIEN,
  SCAN_THE_THINGS as THE_THINGS,
  metadataProber,
} from "../../testing/scan-metadata.js";
import { recordingLog } from "../../testing/recording-log.js";
import { ScriptedTmdbFetch } from "../../testing/scripted-tmdb-fetch.js";
import { createBarrier } from "../../testing/test-barrier.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import type { ScanStatus } from "../contracts.js";
import { CatalogScanWriter } from "../writer/catalog-scan-writer.js";
import { CatalogScanner } from "./catalog-scanner.js";
import { isRunning } from "./scan-job.js";

afterEach(cleanUpTestEnvironment);

// A native root path, since path hints read folders with this platform's rules.
const ROOT = resolve(rootFixture.path);

const KEY = "eyJ.owner-token.sig";
interface SetupOptions {
  /** Saves the owner's key before scanning; defaults to true. */
  key?: boolean;
  /** Paths below the fixture root that each scan discovers. */
  files: string[];
  /** Fails the probe of these paths below the root. */
  probeFailures?: string[];
  /** Wraps the real client, for a lookup that fails in a way TMDB cannot. */
  tmdb?: (
    client: TmdbClient,
  ) => Pick<TmdbClient, "checkKey" | "searchMovies" | "movieDetails">;
}

// Wires a scanner with real persistence and the real TMDB client over a scripted TMDB.
async function setup({
  key = true,
  files,
  probeFailures = [],
  tmdb: wrap,
}: SetupOptions) {
  const { db } = await openTestDatabase();
  await db
    .insertInto("media_roots")
    .values({ ...rootFixture, path: ROOT, path_key: ROOT })
    .execute();
  const tmdb = new ScriptedTmdbFetch();
  tmdb.movies.push(ALIEN, ...THE_THINGS);
  tmdb.validKeys.add(KEY);
  if (key) {
    await db
      .updateTable("server_settings")
      .set({ tmdb_api_key: KEY })
      .execute();
  }
  const client = new TmdbClient({ fetch: tmdb.fetch, timeoutMs: 1_000 });
  const prober = metadataProber(ROOT, probeFailures);
  let time = 1_704_067_200_000;
  const scanner = new CatalogScanner({
    roots: new MediaRootRepository(db),
    prober,
    writer: new CatalogScanWriter(db),
    schedules: { ensureAllEnabled: async () => {} },
    removals: { purge: async () => {} },
    log: recordingLog(),
    metadata: {
      tmdbKeys: new TmdbKeyService(db, client),
      metadataMatches: new MetadataMatchRepository(db),
      // A wrapper keeps the real client's surface, so the cast adds nothing.
      tmdb: wrap ? (wrap(client) as TmdbClient) : client,
    },
    discover: async () =>
      files.map((file) => {
        const path = join(ROOT, file);
        return { path, pathKey: path, title: file };
      }),
    now: () => (time += 1_000),
  });
  return { db, scanner, tmdb };
}

type Setup = Awaited<ReturnType<typeof setup>>;

// Waits for the fixture root's job to reach its terminal status.
function finished({ scanner }: Setup): Promise<ScanStatus> {
  return vi.waitFor(() => {
    const status = scanner.status(rootFixture.id);
    if (status === undefined || isRunning(status)) throw new Error("running");
    return status;
  });
}

// Starts a scan of the fixture root and waits for its terminal status.
async function scan(context: Setup): Promise<ScanStatus> {
  const started = await context.scanner.start(rootFixture.id);
  if (started.kind !== "started") throw new Error(started.kind);
  return finished(context);
}

// Reads each item's match decision by the item's path below the root.
async function decisions({ db }: Setup) {
  const rows = await db
    .selectFrom("metadata_matches")
    .innerJoin(
      "media_items",
      "media_items.id",
      "metadata_matches.media_item_id",
    )
    .select(["media_items.path", "state", "extra", "lookup_error"])
    .orderBy("media_items.path")
    .execute();
  return rows.map((row) => ({
    file: row.path.slice(ROOT.length + 1).replaceAll("\\", "/"),
    state: row.state,
    extra: row.extra === 1,
    lookupError: row.lookup_error,
  }));
}

describe("CatalogScanner enrichment", () => {
  it("looks movies up between probing and committing: Alien matches, The Thing stays ambiguous", async () => {
    const context = await setup({
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
    const status = await finished(context);

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
    await expect(decisions(context)).resolves.toEqual([
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
    const context = await setup({
      key: false,
      files: ["Alien (1979)/movie.mkv"],
    });

    const status = await scan(context);

    expect(status).toMatchObject({
      phase: "completed",
      lookupCount: 0,
      summary: { matchedCount: 0, lookupErrorCount: 0 },
    });
    expect(context.tmdb.requests).toEqual([]);
    await expect(decisions(context)).resolves.toEqual([]);
  });

  it("makes no TMDB call when rescanning a matched and an ambiguous item", async () => {
    const context = await setup({
      files: ["Alien (1979)/movie.mkv", "The Thing/movie.mkv"],
    });
    await scan(context);
    const calls = context.tmdb.requests.length;

    const rescan = await scan(context);

    expect(context.tmdb.requests).toHaveLength(calls);
    expect(rescan).toMatchObject({ phase: "completed", lookupCount: 0 });
    await expect(decisions(context)).resolves.toMatchObject([
      { state: "matched" },
      { state: "ambiguous" },
    ]);
  });

  it("searches a title and year once for every file that shares it", async () => {
    const context = await setup({
      files: ["Alien (1979)/movie.mkv", "Alien (1979)/alien.mkv"],
    });

    const status = await scan(context);

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
    const context = await setup({ files: ["Gladiator.2000.mkv"] });
    context.tmdb.movies.push({
      id: 98,
      title: "Gladiator",
      releaseDate: "2000-05-01",
    });

    await scan(context);

    expect(
      context.tmdb.requests.map((url) => url.searchParams.get("query")),
    ).toEqual([null, "Gladiator 2000", "Gladiator", null]);
    await expect(decisions(context)).resolves.toMatchObject([
      { state: "matched" },
    ]);
  });

  it("retries a lookup TMDB answers with 429", async () => {
    const context = await setup({ files: ["Alien (1979)/movie.mkv"] });
    context.tmdb.forcedStatuses.push(429);

    await scan(context);

    expect(context.tmdb.paths()).toEqual([
      "/3/authentication",
      "/3/search/movie",
      "/3/search/movie",
      "/3/movie/348",
    ]);
    await expect(decisions(context)).resolves.toMatchObject([
      { state: "matched" },
    ]);
  });

  it("records a lookup error after a fourth 429", async () => {
    const context = await setup({ files: ["Alien (1979)/movie.mkv"] });
    context.tmdb.forcedStatuses.push(429, 429, 429, 429);

    const status = await scan(context);

    expect(status).toMatchObject({ summary: { lookupErrorCount: 1 } });
    await expect(decisions(context)).resolves.toMatchObject([
      { state: "unmatched", lookupError: "TMDB answered HTTP 429" },
    ]);
  });

  it("checks a saved key once and records a rejected key without searching", async () => {
    const context = await setup({
      files: ["Alien (1979)/movie.mkv", "The Thing/movie.mkv"],
    });
    context.tmdb.validKeys.clear();

    const status = await scan(context);

    expect(context.tmdb.paths()).toEqual(["/3/authentication"]);
    expect(status).toMatchObject({
      phase: "completed",
      summary: { lookupErrorCount: 2 },
    });
    await expect(decisions(context)).resolves.toMatchObject([
      { state: "unmatched", lookupError: "TMDB rejected the key" },
      { state: "unmatched", lookupError: "TMDB rejected the key" },
    ]);
  });

  it("fails the scan on an unexpected lookup error only after every lookup settles, committing nothing", async () => {
    const context = await setup({
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

    const status = await scan(context);

    expect(status).toMatchObject({
      phase: "failed",
      error: { code: "scan_failed" },
    });
    await expect(
      context.db.selectFrom("media_items").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("records a failed lookup per item and keeps the item available", async () => {
    const context = await setup({ files: ["Alien (1979)/movie.mkv"] });
    context.tmdb.unreachable = true;

    const status = await scan(context);

    expect(status).toMatchObject({
      phase: "completed",
      summary: { lookupErrorCount: 1, probeFailedCount: 0 },
    });
    await expect(decisions(context)).resolves.toEqual([
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
    const context = await setup({ files: ["Alien (1979)/movie.mkv"] });
    context.tmdb.unreachable = true;
    await scan(context);
    context.tmdb.unreachable = false;

    await scan(context);

    await expect(decisions(context)).resolves.toMatchObject([
      { state: "matched", lookupError: null },
    ]);
  });

  it("records an extra without a lookup, and skips episodes and failed probes", async () => {
    const context = await setup({
      files: [
        "Alien (1979)/Featurettes/making-of.mkv",
        "Firefly/Season 1/s01e05.mkv",
        "Broken (2001)/movie.mkv",
      ],
      probeFailures: ["Broken (2001)/movie.mkv"],
    });

    const status = await scan(context);

    expect(context.tmdb.requests).toEqual([]);
    expect(status).toMatchObject({ phase: "completed", lookupCount: 0 });
    await expect(decisions(context)).resolves.toEqual([
      {
        file: "Alien (1979)/Featurettes/making-of.mkv",
        state: "unmatched",
        extra: true,
        lookupError: null,
      },
    ]);
  });

  it("cancels during enriching only after every started lookup settles, committing nothing", async () => {
    const context = await setup({
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
    const status = await finished(context);

    expect(status.phase).toBe("cancelled");
    expect(context.tmdb.paths()).toEqual([
      "/3/authentication",
      "/3/search/movie",
      "/3/search/movie",
    ]);
    await expect(
      context.db.selectFrom("media_items").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(decisions(context)).resolves.toEqual([]);
  });
});
