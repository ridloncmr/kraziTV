import {
  SCAN_FIREFLY as FIREFLY,
  SCAN_DOCTOR_WHO as DOCTOR_WHO,
} from "../../testing/scan-metadata.js";
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

describe("CatalogScanner episode enrichment", () => {
  it("matches every episode under two season folders with one series search and one fetch per season", async () => {
    const context = await setupEnrichmentScan({
      files: [
        "Firefly/Season 1/s01e01.mkv",
        "Firefly/Season 1/s01e05.mkv",
        "Firefly/Season 2/s02e01.mkv",
      ],
    });
    context.tmdb.series.push(FIREFLY);

    const status = await scanToEnd(context);

    expect(context.tmdb.paths().sort()).toEqual([
      "/3/authentication",
      "/3/search/tv",
      "/3/tv/1437",
      "/3/tv/1437/season/1",
      "/3/tv/1437/season/2",
    ]);
    expect(status).toMatchObject({
      phase: "completed",
      lookupCount: 3,
      lookedUpCount: 3,
      summary: { matchedCount: 3 },
    });
    await expect(episodeFacts(context)).resolves.toEqual([
      { series: 1437, season: 1, episode: 1, last: 1, title: "Firefly 1x1" },
      { series: 1437, season: 1, episode: 5, last: 5, title: "Firefly 1x5" },
      { series: 1437, season: 2, episode: 1, last: 1, title: "Firefly 2x1" },
    ]);
  });

  it("leaves Doctor Who without a year ambiguous, offering both series", async () => {
    const context = await setupEnrichmentScan({
      files: ["Doctor Who/s01e01.mkv"],
    });
    context.tmdb.series.push(...DOCTOR_WHO);

    await scanToEnd(context);

    await expect(matchDecisions(context)).resolves.toEqual([
      {
        file: "Doctor Who/s01e01.mkv",
        state: "ambiguous",
        extra: false,
        lookupError: null,
      },
    ]);
    await expect(
      context.db
        .selectFrom("metadata_match_candidates")
        .select("tmdb_id")
        .orderBy("position")
        .execute(),
    ).resolves.toEqual([{ tmdb_id: 121 }, { tmdb_id: 57243 }]);
  });

  it("matches specials under Specials/ and keeps both numbers of a two-part file", async () => {
    const context = await setupEnrichmentScan({
      files: ["Firefly/Specials/s00e01.mkv", "Firefly/s01e05-e06.mkv"],
    });
    context.tmdb.series.push(FIREFLY);

    await scanToEnd(context);

    await expect(episodeFacts(context)).resolves.toEqual([
      { series: 1437, season: 0, episode: 1, last: 1, title: "Firefly 0x1" },
      {
        series: 1437,
        season: 1,
        episode: 5,
        last: 6,
        title: "Firefly 1x5 / Firefly 1x6",
      },
    ]);
  });

  it("cancels while a season is being fetched, committing nothing", async () => {
    const context = await setupEnrichmentScan({
      files: ["Firefly/Season 1/s01e01.mkv", "Firefly/Season 2/s02e01.mkv"],
    });
    context.tmdb.series.push(FIREFLY);
    const held = createBarrier();
    context.tmdb.holds.set("/3/tv/1437/season/2", held);
    await context.scanner.start(rootFixture.id);
    await held.reached;

    expect(context.scanner.cancel(rootFixture.id)).toMatchObject({
      phase: "enriching",
      cancelRequested: true,
    });
    held.release();
    const status = await waitForScanEnd(context);

    expect(status.phase).toBe("cancelled");
    await expect(
      context.db.selectFrom("media_items").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(matchDecisions(context)).resolves.toEqual([]);
  });

  it("never looks up an extra or a disc track", async () => {
    const context = await setupEnrichmentScan({
      files: ["Firefly/Featurettes/s01e01.mkv", "Some Show/t_01.mkv"],
    });
    context.tmdb.series.push(FIREFLY);

    const status = await scanToEnd(context);

    expect(context.tmdb.requests).toEqual([]);
    expect(status).toMatchObject({ phase: "completed", lookupCount: 0 });
    await expect(matchDecisions(context)).resolves.toEqual([
      {
        file: "Firefly/Featurettes/s01e01.mkv",
        state: "unmatched",
        extra: true,
        lookupError: null,
      },
    ]);
  });
});

// Reads each matched episode's series, numbers, and title, in path order.
async function episodeFacts({
  db,
}: Awaited<ReturnType<typeof setupEnrichmentScan>>) {
  const rows = await db
    .selectFrom("content_facts")
    .innerJoin("media_items", "media_items.id", "content_facts.media_item_id")
    .select([
      "series_tmdb_id",
      "season_number",
      "episode_number",
      "last_episode_number",
      "content_facts.title",
    ])
    .where("content_type", "=", "episode")
    .orderBy("media_items.path")
    .execute();
  return rows.map((row) => ({
    series: row.series_tmdb_id,
    season: row.season_number,
    episode: row.episode_number,
    last: row.last_episode_number,
    title: row.title,
  }));
}
