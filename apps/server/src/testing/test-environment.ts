import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance, FastifyServerOptions } from "fastify";
import type { Kysely } from "kysely";

import { buildServer, type ServerDependencies } from "../app.js";
import { CatalogScanner } from "../catalog-scan/scanner/catalog-scanner.js";
import { CatalogScanWriter } from "../catalog-scan/writer/catalog-scan-writer.js";
import {
  openDatabase,
  type KraziDatabase,
  type OpenDatabaseOptions,
} from "../database/database.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { ChannelRepository } from "../channels/repository/channel-repository.js";
import { noOpChannelRuntime } from "../channels/runtime/no-op-channel-runtime.js";
import { ProgrammingBlockRepository } from "../programming-blocks/programming-block-repository.js";
import { PlayoutService } from "../playout/playout-service.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { MediaCollectionRepository } from "../media-collections/media-collection-repository.js";
import { MediaItemRepository } from "../media-items/media-item-repository.js";
import { MediaRootRepository } from "../media-roots/media-root-repository.js";
import { ControlledChannelStreams } from "./controlled-channel-streams.js";
import { ControlledProber } from "./controlled-prober.js";

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
  /** Fastify logger options; defaults to silent so test output stays clean. */
  logger?: FastifyServerOptions["logger"];
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
  const defaults: TestServerDependencies = {
    mediaRoots,
    scanner: new CatalogScanner({
      roots: mediaRoots,
      prober: new ControlledProber(),
      writer: new CatalogScanWriter(database.db),
    }),
    mediaItems: new MediaItemRepository(database.db),
    mediaCollections: new MediaCollectionRepository(database.db),
    channels: new ChannelRepository(database.db),
    channelRuntime: noOpChannelRuntime,
    channelStreams: new ControlledChannelStreams(),
    programmingBlocks: new ProgrammingBlockRepository(database.db),
    schedules,
    playout: new PlayoutService(database.db, schedules),
  };
  const overridden = options.overrides?.(database.db, defaults) ?? {};
  const dependencies: TestServerDependencies = { ...defaults, ...overridden };
  // A default playout service follows the final schedule service, so
  // overriding `schedules` alone keeps the two on one clock.
  if (overridden.playout === undefined) {
    dependencies.playout = new PlayoutService(
      database.db,
      dependencies.schedules,
    );
  }
  const server = buildServer(
    { database, ...dependencies },
    {
      logger: options.logger ?? false,
      channelStopTimeoutMs: options.channelStopTimeoutMs,
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
