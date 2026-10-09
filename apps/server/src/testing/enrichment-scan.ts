// Test-only scanner wiring for enrichment suites; production code must never import this module.
import { join, resolve } from "node:path";

import { TmdbClient } from "@krazitv/media";
import { vi } from "vitest";

import { MetadataMatchRepository } from "../content-metadata/metadata-match-repository.js";
import { TmdbKeyService } from "../content-metadata/tmdb-key-service.js";
import { MediaRootRepository } from "../media-roots/media-root-repository.js";
import type { ScanStatus } from "../catalog-scan/contracts.js";
import { CatalogScanner } from "../catalog-scan/scanner/catalog-scanner.js";
import { isRunning } from "../catalog-scan/scanner/scan-job.js";
import { CatalogScanWriter } from "../catalog-scan/writer/catalog-scan-writer.js";
import { rootFixture } from "./catalog-fixtures.js";
import { recordingLog } from "./recording-log.js";
import {
  SCAN_ALIEN as ALIEN,
  SCAN_THE_THINGS as THE_THINGS,
  metadataProber,
} from "./scan-metadata.js";
import { ScriptedTmdbFetch } from "./scripted-tmdb-fetch.js";
import { openTestDatabase } from "./test-environment.js";

// A native root path, since path hints read folders with this platform's rules.
export const ROOT = resolve(rootFixture.path);

const KEY = "eyJ.owner-token.sig";
interface SetupOptions {
  /** Saves the owner's key before scanning; defaults to true. */
  key?: boolean;
  /** Paths below the fixture root that each scan discovers. */
  files: string[];
  /** Fails the probe of these paths below the root. */
  probeFailures?: string[];
  /** Wraps the real client, for a lookup that fails in a way TMDB cannot. */
  tmdb?: (client: TmdbClient) => Partial<TmdbClient>;
}

// Wires a scanner with real persistence and the real TMDB client over a scripted TMDB.
export async function setupEnrichmentScan({
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

type EnrichmentScan = Awaited<ReturnType<typeof setupEnrichmentScan>>;

// Waits for the fixture root's job to reach its terminal status.
export function waitForScanEnd({
  scanner,
}: EnrichmentScan): Promise<ScanStatus> {
  return vi.waitFor(() => {
    const status = scanner.status(rootFixture.id);
    if (status === undefined || isRunning(status)) throw new Error("running");
    return status;
  });
}

// Starts a scan of the fixture root and waits for its terminal status.
export async function scanToEnd(context: EnrichmentScan): Promise<ScanStatus> {
  const started = await context.scanner.start(rootFixture.id);
  if (started.kind !== "started") throw new Error(started.kind);
  return waitForScanEnd(context);
}

// Reads each item's match decision by the item's path below the root.
export async function matchDecisions({ db }: EnrichmentScan) {
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
