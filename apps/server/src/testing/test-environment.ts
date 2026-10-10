import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TmdbClient } from "@krazitv/media";
import type {
  FastifyInstance,
  FastifyServerOptions,
  RouteOptions,
} from "fastify";
import type { Kysely } from "kysely";
import { pino } from "pino";

import { buildServer, type ServerDependencies } from "../app.js";
import { AuthService } from "../auth/auth-service.js";
import { MetadataMatchRepository } from "../content-metadata/persistence/metadata-match-repository.js";
import { MatchChoiceService } from "../content-metadata/match-choice/match-choice-service.js";
import { CorrectionService } from "../content-metadata/corrections/correction-service.js";
import { TrackMappingService } from "../content-metadata/track-mapping/track-mapping-service.js";
import { TmdbKeyService } from "../content-metadata/tmdb-key/tmdb-key-service.js";
import { CatalogScanner } from "../catalog-scan/scanner/catalog-scanner.js";
import { CatalogScanWriter } from "../catalog-scan/writer/catalog-scan-writer.js";
import { CatalogRemovalService } from "../catalog-removal/catalog-removal-service.js";
import {
  openDatabase,
  type KraziDatabase,
  type OpenDatabaseOptions,
} from "../database/database.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { ChannelRepository } from "../channels/repository/channel-repository.js";
import { ProgrammingBlockRepository } from "../programming-blocks/programming-block-repository.js";
import { PlayoutService } from "../playout/playout-service.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { MediaCollectionRepository } from "../media-collections/media-collection-repository.js";
import { MediaItemRepository } from "../media-items/media-item-repository.js";
import { MediaRootRepository } from "../media-roots/media-root-repository.js";
import type { PlexSettings } from "../plex/plex-routes.js";
import { ControlledChannelStreams } from "./controlled-channel-streams.js";
import { ControlledProber } from "./controlled-prober.js";
import { plexSettingsFixture } from "./plex-fixtures.js";
import { RecordingChannelRuntime } from "./recording-channel-runtime.js";
import { IdleMetadataRefresh } from "./idle-metadata-refresh.js";
import { ScriptedTmdbFetch } from "./scripted-tmdb-fetch.js";
import { SignedInAuthenticator } from "./signed-in-authenticator.js";

/** Every server dependency except the database, which the helper always opens. */
export type TestServerDependencies = Omit<ServerDependencies, "database">;

export interface StartTestServerOptions {
  /** Reopens an existing data directory, for restart tests; defaults to a fresh one. */
  dataDirectory?: string | undefined;
  /** Writes fixture rows before the server is built. */
  seed?: (db: Kysely<DatabaseSchema>) => Promise<void>;
  /** Replaces only the dependencies a test cares about; defaults share the same database. */
  overrides?: (
    db: Kysely<DatabaseSchema>,
    defaults: TestServerDependencies,
  ) => Partial<TestServerDependencies>;
  /** Overrides the channel routes' runtime stop deadline, for hung-stop tests. */
  channelStopTimeoutMs?: number | undefined;
  /** Replaces only the Plex settings a test cares about; the rest come from the fixture. */
  plex?: Partial<PlexSettings>;
  /** Fastify logger options; defaults to silent so test output stays clean. */
  logger?: FastifyServerOptions["logger"];
  /**
   * Who the auth gate asks. `signed-in` (the default) admits every request,
   * so suites about other domains need no cookies; `real` gates with the
   * final `auth` service, for suites about authentication and public routes.
   */
  auth?: "signed-in" | "real";
  /** Observes every route as the server registers it, for route coverage tests. */
  onRoute?: ((route: RouteOptions) => void) | undefined;
}

export interface TestServer {
  server: FastifyInstance;
  db: Kysely<DatabaseSchema>;
  /** The dependencies the server was built with, after overrides. */
  dependencies: TestServerDependencies;
}

const servers: FastifyInstance[] = [];
const databases: KraziDatabase[] = [];
const temporaryDirectories: string[] = [];

/**
 * Opens a migrated database that cleanUpTestEnvironment closes. Pass a data
 * directory to reopen one, for restart tests; defaults to a fresh one.
 */
export async function openTestDatabase(
  dataDirectory?: string,
  options: Omit<OpenDatabaseOptions, "dataDirectory"> = {},
): Promise<KraziDatabase> {
  const database = await openDatabase({
    ...options,
    dataDirectory: dataDirectory ?? (await createTemporaryDirectory()),
  });
  databases.push(database);
  return database;
}

/**
 * Boots the real composition over a temporary SQLite file. The default scanner
 * uses an idle ControlledProber, so tests that never scan need no ffprobe.
 */
export async function startTestServer(
  options: StartTestServerOptions = {},
): Promise<TestServer> {
  const database = await openTestDatabase(options.dataDirectory);
  await options.seed?.(database.db);

  const mediaRoots = new MediaRootRepository(database.db);
  const schedules = new ScheduleService(database.db);
  // Removals ask the scanner whether a root is scanning, and every completed
  // scan purges. Each reaches the other through the final dependency set when
  // called, so an override of either one is followed.
  const wired: { dependencies?: TestServerDependencies } = {};
  const isScanning = (rootId: string) =>
    wired.dependencies?.scanner.isScanning(rootId) ?? false;
  const removals: Pick<CatalogRemovalService, "purge"> = {
    purge: async (log) => wired.dependencies?.catalogRemovals.purge(log),
  };
  // A scripted TMDB that accepts no key, so no suite ever calls the real
  // one. Key saves and scans share it, as they share one client in index.ts.
  const tmdb = new TmdbClient({
    fetch: new ScriptedTmdbFetch().fetch,
    timeoutMs: 1_000,
  });
  const tmdbKeys = new TmdbKeyService(database.db, tmdb);
  const matchChoices = new MatchChoiceService(database.db, tmdbKeys, tmdb);
  // Built per dependency set, so the default scanner can follow overrides.
  const defaultScanner = (
    roots: MediaRootRepository,
    scheduleService: ScheduleService,
  ) =>
    new CatalogScanner({
      roots,
      prober: new ControlledProber(),
      writer: new CatalogScanWriter(database.db),
      schedules: scheduleService,
      removals,
      metadataRefresh: new IdleMetadataRefresh(),
      metadata: {
        tmdbKeys,
        metadataMatches: new MetadataMatchRepository(database.db),
        tmdb,
      },
      log: pino({ level: "silent" }),
    });
  // Built per dependency set, so default removals follow an overridden
  // schedule service.
  const defaultRemovals = (scheduleService: ScheduleService) =>
    new CatalogRemovalService(database.db, {
      schedules: scheduleService,
      isScanning,
    });
  const auth = new AuthService(database.db);
  const defaults: TestServerDependencies = {
    auth,
    authenticator: options.auth === "real" ? auth : new SignedInAuthenticator(),
    tmdbKeys,
    matchChoices,
    corrections: new CorrectionService(database.db),
    trackMappings: new TrackMappingService(database.db, tmdbKeys, tmdb),
    // No background TMDB pass races what a suite asserts; refresh suites
    // drive the real service directly.
    metadataRefresh: new IdleMetadataRefresh(),
    mediaRoots,
    scanner: defaultScanner(mediaRoots, schedules),
    mediaItems: new MediaItemRepository(database.db),
    mediaCollections: new MediaCollectionRepository(database.db),
    catalogRemovals: defaultRemovals(schedules),
    channels: new ChannelRepository(database.db),
    channelRuntime: new RecordingChannelRuntime(),
    channelStreams: new ControlledChannelStreams(),
    programmingBlocks: new ProgrammingBlockRepository(database.db),
    schedules,
    playout: new PlayoutService(database.db, schedules),
  };
  const overridden = options.overrides?.(database.db, defaults) ?? {};
  const dependencies: TestServerDependencies = { ...defaults, ...overridden };
  // A default playout service, scanner, and removal service follow the final
  // schedule service (and the scanner the final roots), so overriding
  // `schedules` alone keeps every consumer on one clock and one service.
  if (overridden.playout === undefined) {
    dependencies.playout = new PlayoutService(
      database.db,
      dependencies.schedules,
    );
  }
  if (overridden.scanner === undefined) {
    dependencies.scanner = defaultScanner(
      dependencies.mediaRoots,
      dependencies.schedules,
    );
  }
  if (overridden.catalogRemovals === undefined) {
    dependencies.catalogRemovals = defaultRemovals(dependencies.schedules);
  }
  // Real gating follows an overridden auth service, so a test that steps the
  // auth clock gates on that same clock.
  if (options.auth === "real" && overridden.authenticator === undefined) {
    dependencies.authenticator = dependencies.auth;
  }
  wired.dependencies = dependencies;
  const server = buildServer(
    { database, ...dependencies },
    {
      logger: options.logger ?? false,
      channelStopTimeoutMs: options.channelStopTimeoutMs,
      plex: { ...plexSettingsFixture, ...options.plex },
      onRoute: options.onRoute,
    },
  );
  servers.push(server);
  return { server, db: database.db, dependencies };
}

/** Creates a directory that cleanUpTestEnvironment removes after the test. */
export async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "krazitv-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * Closes servers and databases before removing directories, because an open
 * SQLite file keeps its directory locked on Windows. Call from afterEach.
 */
export async function cleanUpTestEnvironment(): Promise<void> {
  // Servers close their own database too; close() is idempotent, so the
  // second close from the databases list is harmless.
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(databases.splice(0).map((database) => database.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}
