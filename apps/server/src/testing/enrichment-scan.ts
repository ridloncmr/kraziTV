// Test-only scanner wiring for enrichment suites; production code must never import this module.
import { join, resolve } from "node:path";

import { TmdbClient } from "@krazitv/media";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { expect, vi } from "vitest";

import { MatchChoiceService } from "../content-metadata/match-choice/match-choice-service.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { MetadataMatchRepository } from "../content-metadata/persistence/metadata-match-repository.js";
import { TmdbKeyService } from "../content-metadata/tmdb-key/tmdb-key-service.js";
import { MediaRootRepository } from "../media-roots/media-root-repository.js";
import type { ScanStatus } from "../catalog-scan/contracts.js";
import { CatalogScanner } from "../catalog-scan/scanner/catalog-scanner.js";
import { isRunning } from "../catalog-scan/scanner/scan-job.js";
import { CatalogScanWriter } from "../catalog-scan/writer/catalog-scan-writer.js";
import { send, waitForScan } from "./api-requests.js";
import { rootFixture } from "./catalog-fixtures.js";
import { recordingLog } from "./recording-log.js";
import {
  SCAN_ALIEN as ALIEN,
  SCAN_FIREFLY,
  SCAN_THE_THINGS as THE_THINGS,
  metadataProber,
} from "./scan-metadata.js";
import { ScriptedTmdbFetch } from "./scripted-tmdb-fetch.js";
import { openTestDatabase, startTestServer } from "./test-environment.js";

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
export async function setupEnrichmentScan(options: SetupOptions) {
  const { db } = await openTestDatabase();
  await seedEnrichment(db, options.key ?? true);
  const { tmdb, client } = scriptedTmdb();
  return { db, scanner: enrichmentScanner(db, client, options), tmdb };
}

/**
 * Boots the real server composition with the enrichment scanner, and match
 * choices asking the same scripted TMDB, so route tests scan real decisions.
 */
export async function startEnrichmentServer(options: SetupOptions) {
  const { tmdb, client } = scriptedTmdb();
  const { server, db } = await startTestServer({
    seed: (db) => seedEnrichment(db, options.key ?? true),
    overrides: (db) => ({
      scanner: enrichmentScanner(db, client, options),
      matchChoices: new MatchChoiceService(
        db,
        new TmdbKeyService(db, client),
        client,
      ),
    }),
  });
  return { server, db, tmdb };
}

/** Scans the fixture root through the routes and waits for the job to end. */
export async function scanThroughRoutes(server: FastifyInstance) {
  const started = await send(
    server,
    "POST",
    `/media-roots/${rootFixture.id}/scan`,
  );
  expect(started.status).toBe(202);
  return waitForScan(server, rootFixture.id);
}

/** Reads the ID of the cataloged item at `file` below the root. */
export async function idOf(
  server: FastifyInstance,
  file: string,
): Promise<string> {
  const { body } = await send(server, "GET", "/media-items?limit=200");
  const { items } = body as { items: { id: string; path: string }[] };
  const item = items.find((candidate) => candidate.path === join(ROOT, file));
  if (item === undefined) throw new Error(`${file} is not cataloged`);
  return item.id;
}

// Saves the fixture root at ROOT and, when `key` is set, the owner's key.
async function seedEnrichment(
  db: Kysely<DatabaseSchema>,
  key: boolean,
): Promise<void> {
  await db
    .insertInto("media_roots")
    .values({ ...rootFixture, path: ROOT, path_key: ROOT })
    .execute();
  if (key) {
    await db
      .updateTable("server_settings")
      .set({ tmdb_api_key: KEY })
      .execute();
  }
}

// A scripted TMDB knowing the fixture movies and accepting the owner's key,
// and the real client over it.
function scriptedTmdb() {
  const tmdb = new ScriptedTmdbFetch();
  tmdb.movies.push(ALIEN, ...THE_THINGS);
  tmdb.validKeys.add(KEY);
  const client = new TmdbClient({ fetch: tmdb.fetch, timeoutMs: 1_000 });
  return { tmdb, client };
}

// A scanner with real persistence that discovers `files` below ROOT.
function enrichmentScanner(
  db: Kysely<DatabaseSchema>,
  client: TmdbClient,
  { files, probeFailures = [], tmdb: wrap }: SetupOptions,
): CatalogScanner {
  let time = 1_704_067_200_000;
  return new CatalogScanner({
    roots: new MediaRootRepository(db),
    prober: metadataProber(ROOT, probeFailures),
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

// Patches one item's corrections and returns the status and answered item.
export function correct(server: FastifyInstance, id: string, change: object) {
  return send(server, "PATCH", `/metadata/corrections/${id}`, change);
}

// Reads one item's effective metadata through the item route.
export async function metadataOf(server: FastifyInstance, id: string) {
  const { body } = await send(server, "GET", `/media-items/${id}`);
  return (body as { metadata: Record<string, unknown> }).metadata;
}

// Boots a server over `files`, with Firefly known to TMDB, and scans once.
export async function scannedWithFirefly(
  files: string[],
  options: { key?: boolean } = {},
) {
  const context = await startEnrichmentServer({ files, ...options });
  context.tmdb.series.push(SCAN_FIREFLY);
  await scanThroughRoutes(context.server);
  return context;
}
