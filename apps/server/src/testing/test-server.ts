import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";

import { buildServer, type ServerDependencies } from "../app.js";
import { CatalogScanner } from "../catalog-scan/scanner/catalog-scanner.js";
import { CatalogScanWriter } from "../catalog-scan/writer/catalog-scan-writer.js";
import { openDatabase } from "../database/database.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { MediaCollectionRepository } from "../media-collections/media-collection-repository.js";
import { MediaItemRepository } from "../media-items/media-item-repository.js";
import { MediaRootRepository } from "../media-roots/media-root-repository.js";
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
}

export interface TestServer {
  server: FastifyInstance;
  db: Kysely<DatabaseSchema>;
  /** The dependencies the server was built with, after overrides. */
  dependencies: TestServerDependencies;
}

const servers: FastifyInstance[] = [];
const temporaryDirectories: string[] = [];

/**
 * Boots the real composition over a temporary SQLite file. The default scanner
 * uses an idle ControlledProber, so tests that never scan need no ffprobe.
 */
export async function startTestServer(
  options: StartTestServerOptions = {},
): Promise<TestServer> {
  const dataDirectory =
    options.dataDirectory ?? (await createTemporaryDirectory());
  const database = await openDatabase({ dataDirectory });
  await options.seed?.(database.db);

  const mediaRoots = new MediaRootRepository(database.db);
  const defaults: TestServerDependencies = {
    mediaRoots,
    scanner: new CatalogScanner({
      roots: mediaRoots,
      prober: new ControlledProber(),
      writer: new CatalogScanWriter(database.db),
    }),
    mediaItems: new MediaItemRepository(database.db),
    mediaCollections: new MediaCollectionRepository(database.db),
  };
  const dependencies = {
    ...defaults,
    ...options.overrides?.(database.db, defaults),
  };
  const server = buildServer({ database, ...dependencies }, { logger: false });
  servers.push(server);
  return { server, db: database.db, dependencies };
}

/** Creates a directory that closeTestServers removes after the test. */
export async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "krazitv-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * Closes servers before removing directories, because an open SQLite file
 * keeps its directory locked on Windows. Call from afterEach.
 */
export async function closeTestServers(): Promise<void> {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}
