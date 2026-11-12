import type { Insertable } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MetadataMatchRepository } from "../../content-metadata/persistence/metadata-match-repository.js";
import type { MediaRootTable } from "../../database/schema/media-root-table.js";
import {
  animeRootFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  addRoot,
  catalogNotLookedUp,
  itemId,
  scannedWithFailures,
  ALIEN_PATH as ALIEN,
  matchDecisions,
  retryToEnd,
  scanToEnd,
  setupEnrichmentScan,
  waitForScanEnd,
} from "../../testing/enrichment-scan.js";
import { correctionRow } from "../../testing/metadata-match-fixtures.js";
import { createBarrier } from "../../testing/test-barrier.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(async () => {
  // One case spies on the repository's prototype, which every later case shares.
  vi.restoreAllMocks();
  await cleanUpTestEnvironment();
});

const OUTSTANDING = {
  scope: "outstanding",
  mediaRootId: rootFixture.id,
} as const;
// A movie the scripted TMDB answers with several candidates.
const THE_THING = "The Thing/movie.mkv";
// Never-looked-up files whose path hints give a lookup nothing to search
// for: a disc track waiting for track mapping, and a season-folder file with
// no episode number.
const UNSEARCHABLE = ["Show/Disc 1/title_t00.mkv", "Firefly/Season 1/b.mkv"];
const DISABLED_ROOT: Insertable<MediaRootTable> = {
  ...rootFixture,
  id: "root-disabled",
  path: "/media/disabled",
  path_key: "/media/disabled",
  enabled: 0,
};

describe("CatalogScanner lookup retry", () => {
  it("looks up a root's failed lookups again from enriching, with no probe calls", async () => {
    const context = await scannedWithFailures([ALIEN]);
    const probe = vi.spyOn(context.prober, "probe");

    const started = await context.scanner.retry(OUTSTANDING);
    const status = await waitForScanEnd(context);

    expect(started).toMatchObject({
      kind: "started",
      status: { kind: "retry", phase: "enriching" },
    });
    expect(probe).not.toHaveBeenCalled();
    expect(status).toMatchObject({
      kind: "retry",
      phase: "completed",
      discoveredCount: 0,
      settledCount: 0,
      lookedUpCount: 1,
      summary: { discoveredCount: 0, matchedCount: 1, lookupErrorCount: 0 },
    });
    await expect(matchDecisions(context)).resolves.toEqual([
      { file: ALIEN, state: "matched", extra: false, lookupError: null },
    ]);
  });

  it("looks up a root's never-looked-up files along with its failed lookups", async () => {
    const context = await scannedWithFailures([ALIEN]);
    await catalogNotLookedUp(context, rootFixture.id, THE_THING);

    const status = await retryToEnd(context, OUTSTANDING);

    expect(status).toMatchObject({
      lookupCount: 2,
      summary: { matchedCount: 1, ambiguousCount: 1 },
    });
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { file: ALIEN, state: "matched" },
      { file: THE_THING, state: "ambiguous" },
    ]);
  });

  it("answers scan_in_progress to a scan started during a retry", async () => {
    const context = await scannedWithFailures([ALIEN]);
    const held = createBarrier();
    context.tmdb.holds.set("/3/search/movie", held);

    await context.scanner.retry(OUTSTANDING);
    await held.reached;
    const scan = await context.scanner.start(rootFixture.id);
    held.release();
    await waitForScanEnd(context);

    expect(scan).toEqual({ kind: "scan_in_progress" });
    expect(context.scanner.isScanning(rootFixture.id)).toBe(false);
  });

  it("keeps an item removed while its retry waited on TMDB removed and its decision unchanged", async () => {
    const context = await scannedWithFailures([ALIEN]);
    const id = await itemId(context, ALIEN);
    const held = createBarrier();
    context.tmdb.holds.set("/3/search/movie", held);

    await context.scanner.retry(OUTSTANDING);
    await held.reached;
    // Catalog removal refuses while the retry's job runs, so the removal is
    // written directly, as one racing the job would land.
    await context.db
      .updateTable("media_items")
      .set({ removed_at: 1 })
      .where("id", "=", id)
      .execute();
    held.release();
    const status = await waitForScanEnd(context);

    expect(status.phase).toBe("completed");
    await expect(
      context.db
        .selectFrom("media_items")
        .select("removed_at")
        .where("id", "=", id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ removed_at: 1 });
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "unmatched", lookupError: expect.any(String) },
    ]);
  });

  it("keeps a correction made while the retry waited on TMDB", async () => {
    const context = await scannedWithFailures([ALIEN]);
    const id = await itemId(context, ALIEN);
    const held = createBarrier();
    context.tmdb.holds.set("/3/search/movie", held);

    await context.scanner.retry({ scope: "item", mediaItemId: id });
    await held.reached;
    const correction = correctionRow(id, { title: "My Alien" });
    await context.db
      .insertInto("metadata_corrections")
      .values(correction)
      .execute();
    held.release();
    await waitForScanEnd(context);

    await expect(
      context.db.selectFrom("metadata_corrections").selectAll().execute(),
    ).resolves.toEqual([correction]);
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "matched" },
    ]);
  });

  it("leaves a decision the owner changed while the retry waited on TMDB", async () => {
    const context = await scannedWithFailures([ALIEN]);
    const held = createBarrier();
    context.tmdb.holds.set("/3/search/movie", held);

    await context.scanner.retry(OUTSTANDING);
    await held.reached;
    await context.db
      .updateTable("metadata_matches")
      .set({ state: "rejected", lookup_error: null, lookup_error_kind: null })
      .execute();
    held.release();
    await waitForScanEnd(context);

    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "rejected" },
    ]);
  });

  it("looks up a rejected item again, since a retry is the owner asking", async () => {
    const context = await setupEnrichmentScan({ files: [ALIEN] });
    await scanToEnd(context);
    await context.db
      .updateTable("metadata_matches")
      .set({ state: "rejected" })
      .execute();
    const id = await itemId(context, ALIEN);

    await retryToEnd(context, { scope: "item", mediaItemId: id });

    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "matched" },
    ]);
  });

  it("keeps an accepted match when its retry's lookup fails", async () => {
    const context = await setupEnrichmentScan({ files: [ALIEN] });
    await scanToEnd(context);
    const id = await itemId(context, ALIEN);
    context.tmdb.unreachable = true;

    const status = await retryToEnd(context, {
      scope: "item",
      mediaItemId: id,
    });

    expect(status.summary).toMatchObject({ lookupErrorCount: 1 });
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "matched", lookupError: null },
    ]);
    await expect(
      context.db.selectFrom("content_facts").select("title").execute(),
    ).resolves.toEqual([{ title: "Alien" }]);
  });

  it("retries one folder and the folders below it, never an extra", async () => {
    const context = await scannedWithFailures([
      ALIEN,
      "Alien (1979)/Featurettes/making-of.mkv",
      "Firefly/Season 1/s01e01.mkv",
      "Firefly/Season 2/s02e01.mkv",
    ]);
    const id = await itemId(context, ALIEN);

    const status = await retryToEnd(context, {
      scope: "folder",
      mediaItemId: id,
    });

    expect(status).toMatchObject({ lookupCount: 1 });
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { file: "Alien (1979)/Featurettes/making-of.mkv", extra: true },
      { file: ALIEN, state: "matched" },
      { file: "Firefly/Season 1/s01e01.mkv", lookupError: expect.any(String) },
      { file: "Firefly/Season 2/s02e01.mkv", lookupError: expect.any(String) },
    ]);
  });

  it("refuses an unknown item and a server without a TMDB key", async () => {
    const context = await setupEnrichmentScan({ key: false, files: [ALIEN] });
    await scanToEnd(context);
    const id = await itemId(context, ALIEN);

    await expect(
      context.scanner.retry({ scope: "item", mediaItemId: "nope" }),
    ).resolves.toEqual({ kind: "item_not_found" });
    await expect(
      context.scanner.retry({ scope: "folder", mediaItemId: id }),
    ).resolves.toEqual({ kind: "tmdb_key_missing" });
    expect(context.tmdb.requests).toEqual([]);
  });

  it("cancels during enriching, committing nothing", async () => {
    const context = await scannedWithFailures([ALIEN]);
    const held = createBarrier();
    context.tmdb.holds.set("/3/search/movie", held);

    await context.scanner.retry(OUTSTANDING);
    await held.reached;
    context.scanner.cancel(rootFixture.id);
    held.release();
    const status = await waitForScanEnd(context);

    expect(status.phase).toBe("cancelled");
    await expect(matchDecisions(context)).resolves.toMatchObject([
      { state: "unmatched", lookupError: expect.any(String) },
    ]);
  });
});

describe("CatalogScanner lookup retry of every root", () => {
  it("starts a lookup on every enabled root with outstanding files, counting what they will look up", async () => {
    const context = await scannedWithFailures([ALIEN]);
    await addRoot(context, animeRootFixture);
    await addRoot(context, DISABLED_ROOT);
    await catalogNotLookedUp(context, animeRootFixture.id, ALIEN);
    await catalogNotLookedUp(context, animeRootFixture.id, THE_THING);
    await catalogNotLookedUp(context, DISABLED_ROOT.id, ALIEN);

    const started = await context.scanner.retryEveryRoot();
    const ends = await Promise.all([
      waitForScanEnd(context),
      waitForScanEnd(context, animeRootFixture.id),
    ]);

    expect(started).toEqual({
      kind: "started",
      lookupCount: 3,
      busyRootCount: 0,
    });
    expect(ends).toMatchObject([
      { kind: "retry", phase: "completed", summary: { matchedCount: 1 } },
      {
        kind: "retry",
        phase: "completed",
        summary: { matchedCount: 1, ambiguousCount: 1 },
      },
    ]);
    expect(context.scanner.status(DISABLED_ROOT.id)).toBeUndefined();
  });

  it("skips a root whose scan is running and reports it as busy", async () => {
    const context = await setupEnrichmentScan({ files: [ALIEN] });
    await addRoot(context, animeRootFixture);
    await catalogNotLookedUp(context, animeRootFixture.id, ALIEN);
    const held = createBarrier();
    context.tmdb.holds.set("/3/search/movie", held);
    await context.scanner.start(rootFixture.id);
    await held.reached;

    const started = await context.scanner.retryEveryRoot();
    held.release();
    const [scan, retry] = await Promise.all([
      waitForScanEnd(context),
      waitForScanEnd(context, animeRootFixture.id),
    ]);

    expect(started).toEqual({
      kind: "started",
      lookupCount: 1,
      busyRootCount: 1,
    });
    expect(scan).toMatchObject({ kind: "scan", phase: "completed" });
    expect(retry).toMatchObject({ kind: "retry", phase: "completed" });
  });

  it("starts nothing on a root with nothing outstanding", async () => {
    const context = await setupEnrichmentScan({ files: [ALIEN] });
    await scanToEnd(context);
    const calls = context.tmdb.requests.length;

    const started = await context.scanner.retryEveryRoot();

    expect(started).toEqual({
      kind: "started",
      lookupCount: 0,
      busyRootCount: 0,
    });
    expect(context.scanner.status(rootFixture.id)).toMatchObject({
      kind: "scan",
    });
    expect(context.tmdb.requests).toHaveLength(calls);
  });

  it("refuses without a TMDB key, starting nothing", async () => {
    const context = await setupEnrichmentScan({ key: false, files: [ALIEN] });
    await scanToEnd(context);

    const started = await context.scanner.retryEveryRoot();

    expect(started).toEqual({ kind: "tmdb_key_missing" });
    expect(context.scanner.status(rootFixture.id)).toMatchObject({
      kind: "scan",
    });
    expect(context.tmdb.requests).toEqual([]);
  });

  it("refuses once shutdown has begun", async () => {
    const context = await scannedWithFailures([ALIEN]);
    await context.scanner.shutdown();

    await expect(context.scanner.retryEveryRoot()).resolves.toEqual({
      kind: "shutting_down",
    });
  });

  it("answers shutting_down when shutdown begins between roots, cancelling the jobs it started", async () => {
    // The anime root lists first, so its job starts before the fixture
    // root's outstanding items are read.
    const context = await scannedWithFailures([ALIEN]);
    await addRoot(context, animeRootFixture);
    await catalogNotLookedUp(context, animeRootFixture.id, ALIEN);
    const searching = createBarrier();
    context.tmdb.holds.set("/3/search/movie", searching);
    const reading = createBarrier();
    const read = MetadataMatchRepository.prototype.findRetryItems;
    vi.spyOn(
      MetadataMatchRepository.prototype,
      "findRetryItems",
    ).mockImplementation(async function (this: MetadataMatchRepository, scope) {
      if (scope.scope === "outstanding" && scope.mediaRootId === rootFixture.id)
        await reading.wait();
      return read.call(this, scope);
    });

    const started = context.scanner.retryEveryRoot();
    await Promise.all([searching.reached, reading.reached]);
    const stopped = context.scanner.shutdown();
    searching.release();
    reading.release();

    await expect(started).resolves.toEqual({ kind: "shutting_down" });
    await stopped;
    expect(context.scanner.status(animeRootFixture.id)).toMatchObject({
      kind: "retry",
      phase: "cancelled",
    });
    expect(context.scanner.status(rootFixture.id)).toMatchObject({
      kind: "scan",
    });
  });

  it("treats a root holding only files no lookup searches for as having nothing outstanding", async () => {
    const context = await setupEnrichmentScan({ files: [] });
    await addRoot(context, animeRootFixture);
    for (const file of UNSEARCHABLE) {
      await catalogNotLookedUp(context, animeRootFixture.id, file);
    }

    const everyRoot = await context.scanner.retryEveryRoot();
    const startedRoots = [rootFixture.id, animeRootFixture.id].filter(
      (id) => context.scanner.status(id) !== undefined,
    );
    // The single-root form answers it as it answers the empty fixture root.
    const empty = await retryToEnd(context, OUTSTANDING);
    await context.scanner.retry({
      scope: "outstanding",
      mediaRootId: animeRootFixture.id,
    });
    const unsearchable = await waitForScanEnd(context, animeRootFixture.id);

    expect(everyRoot).toEqual({
      kind: "started",
      lookupCount: 0,
      busyRootCount: 0,
    });
    expect(startedRoots).toEqual([]);
    const nothingLookedUp = {
      kind: "retry",
      phase: "completed",
      lookupCount: 0,
      lookedUpCount: 0,
      summary: { matchedCount: 0, unmatchedCount: 0, lookupErrorCount: 0 },
    };
    expect([empty, unsearchable]).toMatchObject([
      nothingLookedUp,
      nothingLookedUp,
    ]);
    expect(context.tmdb.requests).toEqual([]);
    await expect(matchDecisions(context)).resolves.toEqual([]);
  });
});
