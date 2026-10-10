import { afterEach, describe, expect, it, vi } from "vitest";

import { rootFixture } from "../../testing/catalog-fixtures.js";
import {
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

afterEach(cleanUpTestEnvironment);

const FAILED = { scope: "failed", mediaRootId: rootFixture.id } as const;

describe("CatalogScanner lookup retry", () => {
  it("looks up a root's failed lookups again from enriching, with no probe calls", async () => {
    const context = await scannedWithFailures([ALIEN]);
    const probe = vi.spyOn(context.prober, "probe");

    const started = await context.scanner.retry(FAILED);
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

  it("answers scan_in_progress to a scan started during a retry", async () => {
    const context = await scannedWithFailures([ALIEN]);
    const held = createBarrier();
    context.tmdb.holds.set("/3/search/movie", held);

    await context.scanner.retry(FAILED);
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

    await context.scanner.retry(FAILED);
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

    await context.scanner.retry(FAILED);
    await held.reached;
    await context.db
      .updateTable("metadata_matches")
      .set({ state: "rejected", lookup_error: null })
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

    await context.scanner.retry(FAILED);
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
