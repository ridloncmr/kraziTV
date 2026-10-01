import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import type { Insertable, Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../app.js";
import { openDatabase } from "../database/database.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import {
  FIXTURE_TIME,
  itemFixture,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import { ControlledProber } from "../testing/controlled-prober.js";
import { CatalogScanWriter } from "../catalog-scan/writer/catalog-scan-writer.js";
import { CatalogScanner } from "../catalog-scan/scanner/catalog-scanner.js";
import { MediaRootRepository } from "../media-roots/media-root-repository.js";
import { MediaItemRepository } from "./media-item-repository.js";
import { MediaCollectionRepository } from "../media-collections/media-collection-repository.js";

type Server = FastifyInstance;

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

// A second root whose path sorts before the fixture root even though its ID sorts after.
const animeRoot = {
  ...rootFixture,
  id: "root-fixture-002",
  path: "/media/anime",
  path_key: "/media/anime",
};

const LATER = FIXTURE_TIME + 60_000;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "krazitv-media-items-"));
  temporaryDirectories.push(directory);
  return directory;
}

// Boots the real composition over a fresh database seeded with both roots and the given items.
async function startServer(
  items: Insertable<MediaItemTable>[] = [],
  dataDirectory?: string,
): Promise<Server> {
  return openServer(
    dataDirectory ?? (await createDataDirectory()),
    async (db) => {
      await db
        .insertInto("media_roots")
        .values([rootFixture, animeRoot])
        .execute();
      if (items.length > 0) {
        await db.insertInto("media_items").values(items).execute();
      }
    },
  );
}

// Boots the real composition over an existing data directory, optionally seeding it first.
async function openServer(
  dataDirectory: string,
  seed?: (db: Kysely<DatabaseSchema>) => Promise<void>,
): Promise<Server> {
  const database = await openDatabase({ dataDirectory });
  await seed?.(database.db);

  const mediaRoots = new MediaRootRepository(database.db);
  // These tests never scan, so an idle scanner completes the composition.
  const scanner = new CatalogScanner({
    roots: mediaRoots,
    prober: new ControlledProber(),
    writer: new CatalogScanWriter(database.db),
  });
  const server = buildServer(
    {
      database,
      mediaRoots,
      scanner,
      mediaItems: new MediaItemRepository(database.db),
      mediaCollections: new MediaCollectionRepository(database.db),
    },
    { logger: false },
  );
  servers.push(server);
  return server;
}

function item(
  id: string,
  path: string,
  overrides: Partial<Insertable<MediaItemTable>> = {},
): Insertable<MediaItemTable> {
  return { ...itemFixture, id, path, path_key: path, ...overrides };
}

const firstFailure = item("item-first-failure", "/media/movies/broken.mkv", {
  status: "probe_failed",
  duration_ms: null,
  has_audio: null,
  probe_error: "ffprobe could not read the file",
});

const laterFailure = item("item-later-failure", "/media/movies/corrupt.mkv", {
  status: "probe_failed",
  duration_ms: 1_500_000,
  has_audio: 0,
  probe_error: "ffprobe timed out",
  updated_at: LATER,
  last_seen_at: LATER,
  last_probed_at: LATER,
});

const missing = item("item-missing", "/media/movies/gone.mkv", {
  status: "missing",
  updated_at: LATER,
});

function list(server: Server) {
  return server.inject({ method: "GET", url: "/media-items" });
}

function detail(server: Server, id: string) {
  return server.inject({ method: "GET", url: `/media-items/${id}` });
}

describe("GET /media-items", () => {
  it("returns an empty list before anything is scanned", async () => {
    const server = await startServer();

    const response = await list(server);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("orders by root path, then item path, then item ID", async () => {
    const server = await startServer([
      item("item-001", "/media/movies/b.mkv"),
      item("item-002", "/media/movies/a.mkv"),
      item("item-004", "/media/anime/z.mkv", { media_root_id: animeRoot.id }),
      item("item-003", "/media/anime/z2.mkv", { media_root_id: animeRoot.id }),
    ]);

    const response = await list(server);

    expect(response.json().map(({ id }: { id: string }) => id)).toEqual([
      "item-004",
      "item-003",
      "item-002",
      "item-001",
    ]);
  });
});

describe("GET /media-items/:id", () => {
  it("projects an available item with public fields only", async () => {
    const server = await startServer([itemFixture]);

    const response = await detail(server, "item-fixture-001");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: "item-fixture-001",
      mediaRootId: rootFixture.id,
      path: "/media/movies/example.mkv",
      title: "Example",
      durationMs: 7_200_000,
      hasAudio: true,
      status: "available",
      probeError: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      lastSeenAt: "2024-01-01T00:00:00.000Z",
      lastProbedAt: "2024-01-01T00:00:00.000Z",
    });
  });

  it("keeps history for a missing item while status stays authoritative", async () => {
    const server = await startServer([missing]);

    const response = await detail(server, "item-missing");

    expect(response.json()).toMatchObject({
      status: "missing",
      durationMs: 7_200_000,
      hasAudio: true,
      probeError: null,
      updatedAt: "2024-01-01T00:01:00.000Z",
    });
  });

  it("returns null metadata for a first-time probe failure", async () => {
    const server = await startServer([firstFailure]);

    const response = await detail(server, "item-first-failure");

    expect(response.json()).toMatchObject({
      status: "probe_failed",
      durationMs: null,
      hasAudio: null,
      probeError: "ffprobe could not read the file",
    });
  });

  it("retains last known metadata for a later probe failure", async () => {
    const server = await startServer([laterFailure]);

    const response = await detail(server, "item-later-failure");

    expect(response.json()).toMatchObject({
      status: "probe_failed",
      durationMs: 1_500_000,
      hasAudio: false,
      probeError: "ffprobe timed out",
      lastProbedAt: "2024-01-01T00:01:00.000Z",
    });
  });

  it("reports an unknown item with the structured error envelope", async () => {
    const server = await startServer();

    const response = await detail(server, "item-404");

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "media_item_not_found", message: expect.any(String) },
    });
  });
});

describe("media item persistence", () => {
  it("returns identical items after a server and database restart", async () => {
    const dataDirectory = await createDataDirectory();
    const first = await startServer(
      [itemFixture, missing, firstFailure, laterFailure],
      dataDirectory,
    );
    const before = await list(first);
    await first.close();

    const second = await openServer(dataDirectory);
    const after = await list(second);

    expect(after.json()).toHaveLength(4);
    expect(after.json()).toEqual(before.json());
  });
});
