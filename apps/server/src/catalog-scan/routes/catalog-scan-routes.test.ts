import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import { MediaDiscoveryError, MediaProbeError } from "@krazitv/media";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import { send, waitForScan } from "../../testing/api-requests.js";
import { FIXTURE_TIME, rootFixture } from "../../testing/catalog-fixtures.js";
import { channelFixture } from "../../testing/channel-fixtures.js";
import { ControlledProber } from "../../testing/controlled-prober.js";
import {
  discoveredFiles,
  PROBE_RESULT,
  type Discover,
} from "../../testing/discovery-fixtures.js";
import { flushMicrotasks } from "../../testing/flush-microtasks.js";
import { recordingLog } from "../../testing/recording-log.js";
import {
  readScheduleEntries,
  seedScheduleScenario,
} from "../../testing/schedule-fixtures.js";
import { settleWithin } from "../../testing/settle-within.js";
import { createBarrier } from "../../testing/test-barrier.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import { CatalogScanWriter } from "../writer/catalog-scan-writer.js";
import { CatalogScanner } from "../scanner/catalog-scanner.js";
import { ConcurrencyLimitedProber } from "../scanner/concurrency-limited-prober.js";

type Server = FastifyInstance;
type Writer = Pick<CatalogScanWriter, "commit">;

const SCAN_URL = `/media-roots/${rootFixture.id}/scan`;
const OTHER_ROOT = {
  ...rootFixture,
  id: "root-fixture-002",
  path: "/media/tv",
  path_key: "/media/tv",
};

afterEach(cleanUpTestEnvironment);

interface ServerOptions {
  discover?: Discover;
  /** Wraps the real writer, e.g. to pause or fail the commit. */
  writer?: (real: CatalogScanWriter) => Writer;
  /** Wraps the real schedule pass, e.g. to pause the committing phase. */
  ensureAllEnabled?: ScheduleService["ensureAllEnabled"];
}

// Boots the real composition with two seeded roots, fake discovery, and a controlled prober.
async function startServer(options: ServerOptions = {}) {
  const prober = new ControlledProber();
  const log = recordingLog();
  const discover = vi.fn<Discover>(
    options.discover ?? (async () => discoveredFiles("a", "b")),
  );
  let time = FIXTURE_TIME;
  const { server, db, dependencies } = await startTestServer({
    seed: async (db) => {
      await db
        .insertInto("media_roots")
        .values([rootFixture, OTHER_ROOT])
        .execute();
    },
    overrides: (db, { mediaRoots, schedules }) => {
      const real = new CatalogScanWriter(db);
      return {
        scanner: new CatalogScanner({
          roots: mediaRoots,
          prober: new ConcurrencyLimitedProber(prober, 4),
          writer: options.writer?.(real) ?? real,
          discover,
          schedules: {
            ensureAllEnabled:
              options.ensureAllEnabled ??
              ((scheduleLog) => schedules.ensureAllEnabled(scheduleLog)),
          },
          log,
          now: () => (time += 1_000),
        }),
      };
    },
  });
  return { server, db, prober, discover, log, scanner: dependencies.scanner };
}

function start(server: Server, url = SCAN_URL) {
  return send(server, "POST", url);
}

function read(server: Server, url = SCAN_URL) {
  return send(server, "GET", url);
}

function cancel(server: Server, url = SCAN_URL) {
  return send(server, "DELETE", url);
}

async function catalogRows(db: Kysely<DatabaseSchema>) {
  return {
    items: await db.selectFrom("media_items").selectAll().execute(),
    roots: await db
      .selectFrom("media_roots")
      .selectAll()
      .orderBy("id")
      .execute(),
  };
}

describe("POST /media-roots/:id/scan", () => {
  it("returns 202 with a discovering status before discovery finishes", async () => {
    const discovery = createBarrier();
    const { server, prober } = await startServer({
      discover: async () => {
        await discovery.wait();
        return discoveredFiles("a");
      },
    });

    const response = await start(server);

    expect(response).toEqual({
      status: 202,
      body: {
        id: expect.any(String),
        rootId: rootFixture.id,
        phase: "discovering",
        startedAt: "2024-01-01T00:00:01.000Z",
        finishedAt: null,
        discoveredCount: 0,
        settledCount: 0,
        probeFailedCount: 0,
        currentPath: null,
        cancelRequested: false,
        summary: null,
        error: null,
      },
    });
    discovery.release();
    await prober.waitForStarted(1);
    prober.resolveAll(PROBE_RESULT);
    await waitForScan(server, rootFixture.id);
  });

  it("reports phases in order with growing counts, then today's completed summary", async () => {
    const first = createBarrier();
    const second = createBarrier();
    const schedulePass = createBarrier();
    const { server, prober } = await startServer({
      discover: async (_rootPath, options) => {
        options?.onDiscovered?.(1);
        await first.wait();
        options?.onDiscovered?.(2);
        await second.wait();
        return discoveredFiles("a", "b");
      },
      ensureAllEnabled: () => schedulePass.wait(),
    });

    const { body: started } = await start(server);
    await first.reached;
    expect((await read(server)).body).toMatchObject({
      phase: "discovering",
      discoveredCount: 1,
    });
    first.release();
    await second.reached;
    expect((await read(server)).body).toMatchObject({
      phase: "discovering",
      discoveredCount: 2,
    });
    second.release();

    await prober.waitForStarted(2);
    expect((await read(server)).body).toMatchObject({
      phase: "probing",
      discoveredCount: 2,
      settledCount: 0,
      probeFailedCount: 0,
      currentPath: null,
    });
    prober
      .get("/media/movies/b.mkv")
      .reject(new MediaProbeError("timed_out", "ffprobe timed out"));
    await flushMicrotasks(10);
    expect((await read(server)).body).toMatchObject({
      phase: "probing",
      settledCount: 1,
      probeFailedCount: 1,
      currentPath: "/media/movies/b.mkv",
    });
    prober.get("/media/movies/a.mkv").resolve(PROBE_RESULT);

    await settleWithin(schedulePass.reached, 1_000, "schedule pass");
    expect((await read(server)).body).toMatchObject({
      phase: "committing",
      settledCount: 2,
      probeFailedCount: 1,
      currentPath: null,
      finishedAt: null,
    });
    schedulePass.release();

    expect(await waitForScan(server, rootFixture.id)).toEqual({
      ...started,
      phase: "completed",
      finishedAt: "2024-01-01T00:00:05.000Z",
      discoveredCount: 2,
      settledCount: 2,
      probeFailedCount: 1,
      summary: {
        rootId: rootFixture.id,
        startedAt: "2024-01-01T00:00:01.000Z",
        completedAt: "2024-01-01T00:00:04.000Z",
        discoveredCount: 2,
        probedCount: 1,
        probeFailedCount: 1,
        missingCount: 0,
      },
    });
  });

  it("makes committed scan results readable through the media-item API", async () => {
    const { server, prober } = await startServer();

    await start(server);
    await prober.waitForStarted(2);
    prober.get("/media/movies/a.mkv").resolve(PROBE_RESULT);
    prober
      .get("/media/movies/b.mkv")
      .reject(new MediaProbeError("timed_out", "ffprobe timed out"));
    await waitForScan(server, rootFixture.id);

    const items = await send(server, "GET", "/media-items");
    expect(items.body.items).toEqual([
      expect.objectContaining({
        mediaRootId: rootFixture.id,
        path: "/media/movies/a.mkv",
        status: "available",
        durationMs: 2_000,
      }),
      expect.objectContaining({
        path: "/media/movies/b.mkv",
        status: "probe_failed",
        probeError: "timed_out: ffprobe timed out",
      }),
    ]);
  });

  it("returns 404 for an unknown root", async () => {
    const { server } = await startServer();

    expect(await start(server, "/media-roots/root-unknown/scan")).toEqual({
      status: 404,
      body: {
        error: { code: "media_root_not_found", message: expect.any(String) },
      },
    });
  });

  it("returns a conflict for a disabled root without traversing it", async () => {
    const { server, db, discover } = await startServer();
    await db.updateTable("media_roots").set({ enabled: 0 }).execute();

    expect(await start(server)).toEqual({
      status: 409,
      body: {
        error: { code: "media_root_disabled", message: expect.any(String) },
      },
    });
    expect(discover).not.toHaveBeenCalled();
    expect((await read(server)).status).toBe(404);
  });

  it("returns scan_in_progress for a second scan and leaves the first running", async () => {
    const { server, prober, discover } = await startServer();

    const first = await start(server);
    await prober.waitForStarted(2);

    expect(await start(server)).toEqual({
      status: 409,
      body: {
        error: { code: "scan_in_progress", message: expect.any(String) },
      },
    });
    expect(discover).toHaveBeenCalledTimes(1);
    prober.resolveAll(PROBE_RESULT);
    expect(await waitForScan(server, rootFixture.id)).toMatchObject({
      id: first.body.id,
      phase: "completed",
    });
  });

  it("refuses new scans with scan_cancelled once the scanner is shutting down", async () => {
    const { server, scanner } = await startServer();
    await scanner.shutdown();

    expect(await start(server)).toEqual({
      status: 503,
      body: { error: { code: "scan_cancelled", message: expect.any(String) } },
    });
  });

  it("fails the job with media_root_unavailable and leaves the catalog unchanged", async () => {
    const { server, db, prober } = await startServer({
      discover: async (rootPath) => {
        throw new MediaDiscoveryError(
          "traversal_failed",
          `Could not read media path: ${rootPath}/Season 1`,
          `${rootPath}/Season 1`,
        );
      },
    });
    const before = await catalogRows(db);

    expect((await start(server)).status).toBe(202);

    expect(await waitForScan(server, rootFixture.id)).toMatchObject({
      phase: "failed",
      summary: null,
      error: {
        code: "media_root_unavailable",
        message: "Could not read media path: /media/movies/Season 1",
      },
    });
    expect(prober.started).toHaveLength(0);
    expect(await catalogRows(db)).toEqual(before);
  });

  it("keeps scanning after the client that started it disconnects", async () => {
    const { server, prober } = await startServer();
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
    await new Promise((resolve) => setImmediate(resolve));

    expect(prober.started.some((probe) => probe.signal?.aborted)).toBe(false);
    prober.resolveAll(PROBE_RESULT);
    expect(await waitForScan(server, rootFixture.id)).toMatchObject({
      phase: "completed",
    });
  });

  it("fails an unexpected error with scan_failed, logs the root, and never rejects", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { server, db, prober, log } = await startServer({
        writer: () => ({
          commit: async () => {
            throw new Error("disk full");
          },
        }),
      });
      const before = await catalogRows(db);

      await start(server);
      await prober.waitForStarted(2);
      prober.resolveAll(PROBE_RESULT);

      expect(await waitForScan(server, rootFixture.id)).toMatchObject({
        phase: "failed",
        finishedAt: expect.any(String),
        error: { code: "scan_failed", message: expect.any(String) },
      });
      expect(log.lines).toContainEqual({
        level: "error",
        fields: expect.objectContaining({ rootId: rootFixture.id }),
        message: expect.any(String),
      });
      expect(await catalogRows(db)).toEqual(before);
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("starts a new job after the latest terminal job, which stays readable until then", async () => {
    const { server, prober } = await startServer();

    const first = await start(server);
    await prober.waitForStarted(2);
    prober.resolveAll(PROBE_RESULT);
    const finished = await waitForScan(server, rootFixture.id);
    expect((await read(server)).body).toEqual(finished);
    expect((await read(server)).body).toEqual(finished);

    const second = await start(server);
    expect(second.status).toBe(202);
    expect(second.body.id).not.toBe(first.body.id);
    expect((await read(server)).body).toMatchObject({
      id: second.body.id,
      finishedAt: null,
      summary: null,
    });
    await prober.waitForStarted(4);
    prober.resolveAll(PROBE_RESULT);
    expect(await waitForScan(server, rootFixture.id)).toMatchObject({
      id: second.body.id,
      phase: "completed",
    });
  });
});

describe("GET /media-roots/:id/scan", () => {
  it("distinguishes a root with no scan from an unknown root", async () => {
    const { server } = await startServer();

    expect(await read(server)).toEqual({
      status: 404,
      body: { error: { code: "scan_not_found", message: expect.any(String) } },
    });
    expect(await read(server, "/media-roots/root-unknown/scan")).toEqual({
      status: 404,
      body: {
        error: { code: "media_root_not_found", message: expect.any(String) },
      },
    });
  });

  it("returns the held job even after its root was removed", async () => {
    const { server, db, prober } = await startServer();

    const started = await start(server);
    await prober.waitForStarted(2);
    await db
      .deleteFrom("media_roots")
      .where("id", "=", rootFixture.id)
      .execute();

    expect((await read(server)).body).toMatchObject({
      id: started.body.id,
      phase: "probing",
    });
    prober.resolveAll(PROBE_RESULT);
    expect(await waitForScan(server, rootFixture.id)).toMatchObject({
      phase: "failed",
      error: { code: "media_root_not_found" },
    });
  });
});

describe("DELETE /media-roots/:id/scan", () => {
  it("cancels during discovery without probing or committing", async () => {
    const { server, db, prober, discover } = await startServer({
      discover: (rootPath, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(
              new MediaDiscoveryError(
                "cancelled",
                "Media discovery was cancelled",
                rootPath,
              ),
            ),
          );
        }),
    });
    const before = await catalogRows(db);

    await start(server);
    await vi.waitFor(() => expect(discover).toHaveBeenCalled());
    expect(await cancel(server)).toMatchObject({
      status: 202,
      body: { phase: "discovering", cancelRequested: true },
    });

    expect(await waitForScan(server, rootFixture.id)).toMatchObject({
      phase: "cancelled",
      cancelRequested: true,
      summary: null,
      error: null,
    });
    expect(prober.started).toHaveLength(0);
    expect(await catalogRows(db)).toEqual(before);
  });

  it("cancels during probing only after every probe child has closed", async () => {
    const { server, db, prober } = await startServer();
    const before = await catalogRows(db);

    await start(server);
    await prober.waitForStarted(2);
    expect(await cancel(server)).toMatchObject({
      status: 202,
      body: { phase: "probing", cancelRequested: true },
    });
    await vi.waitFor(() =>
      expect(prober.started.every((probe) => probe.signal?.aborted)).toBe(true),
    );

    // One child is still closing, so the job must not be terminal yet.
    prober.rejectCancelled("/media/movies/a.mkv");
    await flushMicrotasks(10);
    expect((await read(server)).body).toMatchObject({ phase: "probing" });
    prober.rejectCancelled("/media/movies/b.mkv");

    expect(await waitForScan(server, rootFixture.id)).toMatchObject({
      phase: "cancelled",
    });
    expect(await catalogRows(db)).toEqual(before);
  });

  it("leaves a committing job to complete", async () => {
    const commitReached = createBarrier();
    const { server, db, prober } = await startServer({
      writer: (real) => ({
        commit: async (generation) => {
          await commitReached.wait();
          return real.commit(generation);
        },
      }),
    });

    await start(server);
    await prober.waitForStarted(2);
    prober.resolveAll(PROBE_RESULT);
    await settleWithin(commitReached.reached, 1_000, "commit");

    expect(await cancel(server)).toMatchObject({
      status: 202,
      body: { phase: "committing", cancelRequested: false },
    });
    commitReached.release();

    expect(await waitForScan(server, rootFixture.id)).toMatchObject({
      phase: "completed",
      cancelRequested: false,
    });
    expect(
      await db.selectFrom("media_items").select("path").execute(),
    ).toHaveLength(2);
  });

  it("returns the terminal status unchanged, and the same 404s as GET", async () => {
    const { server, prober } = await startServer();

    expect((await cancel(server)).body.error.code).toBe("scan_not_found");
    expect(
      (await cancel(server, "/media-roots/root-unknown/scan")).body.error.code,
    ).toBe("media_root_not_found");

    await start(server);
    await prober.waitForStarted(2);
    prober.resolveAll(PROBE_RESULT);
    const finished = await waitForScan(server, rootFixture.id);
    expect(await cancel(server)).toEqual({ status: 202, body: finished });
  });
});

describe("GET /media-roots scan status", () => {
  it("lists each root's current scan status or null", async () => {
    const { server, prober } = await startServer();

    const started = await start(server);
    await prober.waitForStarted(2);

    // Roots list in path order: /media/movies, then /media/tv.
    expect((await send(server, "GET", "/media-roots")).body).toEqual([
      expect.objectContaining({
        id: rootFixture.id,
        scan: expect.objectContaining({
          id: started.body.id,
          phase: "probing",
          discoveredCount: 2,
        }),
      }),
      expect.objectContaining({ id: OTHER_ROOT.id, scan: null }),
    ]);
    prober.resolveAll(PROBE_RESULT);
    await waitForScan(server, rootFixture.id);
  });
});

describe("scan shutdown", () => {
  it("cancels a running job on server shutdown and closes probes before the database", async () => {
    const { server, prober, db } = await startServer();

    await start(server);
    await prober.waitForStarted(2);
    let closed = false;
    const closing = server.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() =>
      expect(prober.started.every((probe) => probe.signal?.aborted)).toBe(true),
    );
    await flushMicrotasks(10);
    expect(closed).toBe(false);

    prober.rejectCancelled("/media/movies/a.mkv");
    prober.rejectCancelled("/media/movies/b.mkv");
    await closing;

    // The database is closed only after the job settled, so it never saw a write.
    await expect(
      db.selectFrom("media_items").selectAll().execute(),
    ).rejects.toThrow();
  });
});

describe("scan schedule maintenance", () => {
  // Boots with an enabled channel whose only item is missing, so it
  // cannot be scheduled until a scan makes the item available.
  async function startWithUnschedulableChannel(
    discover: Discover = async () => discoveredFiles("item-001"),
  ) {
    const prober = new ControlledProber();
    const { server, db, dependencies } = await startTestServer({
      seed: async (db) => {
        await seedScheduleScenario(db, {
          items: [{ durationMs: 22 * 60_000, status: "missing" }],
          source: "chronological",
        });
      },
      overrides: (db, { mediaRoots, schedules }) => ({
        scanner: new CatalogScanner({
          roots: mediaRoots,
          prober,
          writer: new CatalogScanWriter(db),
          discover,
          schedules,
          log: recordingLog(),
        }),
      }),
    });
    const [root] = await db.selectFrom("media_roots").select("id").execute();
    return { server, db, prober, rootId: root.id, ...dependencies };
  }

  it("schedules a channel before the job completes once a scan makes it schedulable", async () => {
    const { server, db, prober, rootId } =
      await startWithUnschedulableChannel();

    await start(server, `/media-roots/${rootId}/scan`);
    await prober.waitForStarted(1);
    prober.resolveAll({
      durationMs: 22 * 60_000,
      hasAudio: true,
      hasVideo: true,
    });

    expect(await waitForScan(server, rootId)).toMatchObject({
      phase: "completed",
    });
    await expect(
      db.selectFrom("channel_schedule_states").selectAll().execute(),
    ).resolves.toHaveLength(1);
    expect(await readScheduleEntries(db, channelFixture.id)).not.toHaveLength(
      0,
    );
  });

  it("does not ensure schedules when the job did not complete", async () => {
    const { server, schedules, rootId } = await startWithUnschedulableChannel(
      async (rootPath) => {
        throw new MediaDiscoveryError("root_not_found", "gone", rootPath);
      },
    );
    await server.ready();
    const ensureAllEnabled = vi.spyOn(schedules, "ensureAllEnabled");

    await start(server, `/media-roots/${rootId}/scan`);

    expect(await waitForScan(server, rootId)).toMatchObject({
      phase: "failed",
    });
    expect(ensureAllEnabled).not.toHaveBeenCalled();
  });
});
