import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MediaDiscoveryError,
  MediaProbeError,
  type DiscoveredMediaFile,
  type DiscoverMediaFilesOptions,
} from "@krazitv/media";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../app.js";
import { openDatabase } from "../../database/database.js";
import { FIXTURE_TIME, rootFixture } from "../../testing/catalog-fixtures.js";
import { MediaRootRepository } from "../../media-roots/media-root-repository.js";
import { CatalogScanWriter } from "../writer/catalog-scan-writer.js";
import { CatalogScanner } from "../scanner/catalog-scanner.js";
import { ConcurrencyLimitedProber } from "../scanner/concurrency-limited-prober.js";
import { ControlledProber } from "../../testing/controlled-prober.js";
import { MediaItemRepository } from "../../media-items/media-item-repository.js";

type Server = ReturnType<typeof buildServer>;
type Discover = (
  rootPath: string,
  options?: DiscoverMediaFilesOptions,
) => Promise<DiscoveredMediaFile[]>;

const RESULT = { durationMs: 2_000, hasAudio: true };
const SCAN_URL = `/media-roots/${rootFixture.id}/scan`;

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function files(...names: string[]): DiscoveredMediaFile[] {
  return names.map((name) => ({
    path: `/media/movies/${name}.mkv`,
    pathKey: `/media/movies/${name}.mkv`,
    title: name,
  }));
}

// Boots the real composition with a seeded root, fake discovery, and a controlled prober.
async function startServer(discover: Discover = async () => files("a", "b")) {
  const directory = await mkdtemp(join(tmpdir(), "krazitv-scan-routes-"));
  temporaryDirectories.push(directory);
  const database = await openDatabase({ dataDirectory: directory });
  await database.db.insertInto("media_roots").values(rootFixture).execute();

  const prober = new ControlledProber();
  const mediaRoots = new MediaRootRepository(database.db);
  let time = FIXTURE_TIME;
  const discoverSpy = vi.fn<Discover>(discover);
  const scanner = new CatalogScanner({
    roots: mediaRoots,
    prober: new ConcurrencyLimitedProber(prober, 4),
    writer: new CatalogScanWriter(database.db),
    discover: discoverSpy,
    now: () => (time += 1_000),
  });
  const server = buildServer(
    {
      database,
      mediaRoots,
      scanner,
      mediaItems: new MediaItemRepository(database.db),
    },
    { logger: false },
  );
  servers.push(server);
  return { server, prober, scanner, db: database.db, discover: discoverSpy };
}

function scan(server: Server) {
  return server.inject({ method: "POST", url: SCAN_URL });
}

describe("POST /media-roots/:id/scan", () => {
  it("returns the scan summary", async () => {
    const { server, prober } = await startServer();

    const response = scan(server);
    await prober.waitForStarted(2);
    prober.resolveAll(RESULT);

    const result = await response;
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({
      rootId: rootFixture.id,
      startedAt: "2024-01-01T00:00:01.000Z",
      completedAt: "2024-01-01T00:00:04.000Z",
      discoveredCount: 2,
      probedCount: 2,
      probeFailedCount: 0,
      missingCount: 0,
    });
  });

  it("makes committed scan results readable through the media-item API", async () => {
    const { server, prober } = await startServer();

    const response = scan(server);
    await prober.waitForStarted(2);
    prober.get("/media/movies/a.mkv").resolve(RESULT);
    prober
      .get("/media/movies/b.mkv")
      .reject(new MediaProbeError("timed_out", "ffprobe timed out"));
    await response;

    const items = await server.inject({ method: "GET", url: "/media-items" });
    expect(items.json()).toEqual([
      expect.objectContaining({
        mediaRootId: rootFixture.id,
        path: "/media/movies/a.mkv",
        title: "a",
        durationMs: 2_000,
        hasAudio: true,
        status: "available",
        probeError: null,
      }),
      expect.objectContaining({
        path: "/media/movies/b.mkv",
        durationMs: null,
        hasAudio: null,
        status: "probe_failed",
        probeError: "timed_out: ffprobe timed out",
      }),
    ]);
  });

  it("returns 404 for an unknown root", async () => {
    const { server } = await startServer();

    const response = await server.inject({
      method: "POST",
      url: "/media-roots/root-unknown/scan",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "media_root_not_found", message: expect.any(String) },
    });
  });

  it("returns a conflict for a disabled root without traversing it", async () => {
    const { server, db, discover } = await startServer();
    await db.updateTable("media_roots").set({ enabled: 0 }).execute();

    const response = await scan(server);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: "media_root_disabled", message: expect.any(String) },
    });
    expect(discover).not.toHaveBeenCalled();
  });

  it("returns scan_in_progress for a second scan of the same root", async () => {
    const { server, prober } = await startServer();

    const first = scan(server);
    await prober.waitForStarted(2);
    const second = await scan(server);

    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      error: { code: "scan_in_progress", message: expect.any(String) },
    });
    prober.resolveAll(RESULT);
    expect((await first).statusCode).toBe(200);
  });

  it("returns a conflict when the root cannot be traversed", async () => {
    const { server } = await startServer(async (rootPath) => {
      throw new MediaDiscoveryError(
        "traversal_failed",
        `Could not read media path: ${rootPath}/Season 1`,
        `${rootPath}/Season 1`,
      );
    });

    const response = await scan(server);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "media_root_unavailable",
        message: "Could not read media path: /media/movies/Season 1",
      },
    });
  });

  it("does not cancel a scan after its response completes", async () => {
    const signals: AbortSignal[] = [];
    const { server, prober } = await startServer(async (_rootPath, options) => {
      signals.push(options!.signal!);
      return files("a");
    });

    const response = scan(server);
    await prober.waitForStarted(1);
    prober.resolveAll(RESULT);
    expect((await response).statusCode).toBe(200);

    expect(signals[0]?.aborted).toBe(false);
  });

  it("cancels an active scan on server shutdown and closes probes before the database", async () => {
    const { server, prober, db } = await startServer();

    const response = scan(server);
    await prober.waitForStarted(2);
    const closing = server.close();
    await vi.waitFor(() =>
      expect(prober.started.every((probe) => probe.signal?.aborted)).toBe(true),
    );

    prober.rejectCancelled("/media/movies/a.mkv");
    prober.rejectCancelled("/media/movies/b.mkv");
    const result = await response;
    await closing;

    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual({
      error: { code: "scan_cancelled", message: expect.any(String) },
    });
    // The database is closed only after the scan settled, so it never saw a write.
    await expect(
      db.selectFrom("media_items").selectAll().execute(),
    ).rejects.toThrow();
  });

  it("does not scan for a client that disconnected before the handler ran", async () => {
    const { server, discover, db, scanner, prober } = await startServer();
    const scanSpy = vi.spyOn(scanner, "scan");
    // Drops the connection and lets its close event fire before routing finishes.
    server.addHook("preHandler", async (request) => {
      request.raw.socket.destroy();
      await new Promise((resolve) => setImmediate(resolve));
    });
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;

    const clientRequest = httpRequest({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: SCAN_URL,
    });
    clientRequest.on("error", () => undefined);
    clientRequest.end();

    await vi.waitFor(() => expect(scanSpy).toHaveBeenCalled());
    const result = scanSpy.mock.results[0]!.value as Promise<unknown>;
    // Unblocks a wrongly started scan so a regression fails fast instead of hanging.
    const unblock = setInterval(() => prober.resolveAll(RESULT), 5);
    try {
      await expect(result).resolves.toEqual({ kind: "cancelled" });
    } finally {
      clearInterval(unblock);
    }
    expect(discover).not.toHaveBeenCalled();
    expect(await db.selectFrom("media_items").selectAll().execute()).toEqual(
      [],
    );
  });

  it("cancels the scan when the requesting client disconnects", async () => {
    const { server, prober, db, scanner } = await startServer();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;

    const clientRequest = httpRequest({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: SCAN_URL,
    });
    clientRequest.on("error", () => undefined);
    clientRequest.end();
    await prober.waitForStarted(2);

    clientRequest.destroy();
    await vi.waitFor(() =>
      expect(prober.started.every((probe) => probe.signal?.aborted)).toBe(true),
    );
    prober.rejectCancelled("/media/movies/a.mkv");
    prober.rejectCancelled("/media/movies/b.mkv");

    // Shutdown waits for the cancelled scan to settle, so the catalog is final here.
    await scanner.shutdown();
    expect(await db.selectFrom("media_items").selectAll().execute()).toEqual(
      [],
    );
    const root = await db
      .selectFrom("media_roots")
      .select("last_scanned_at")
      .executeTakeFirstOrThrow();
    expect(root.last_scanned_at).toBeNull();
  });
});
