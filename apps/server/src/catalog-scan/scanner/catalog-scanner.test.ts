import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverMediaFiles, MediaProbeError } from "@krazitv/media";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_TIME,
  itemFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import { MediaRootRepository } from "../../media-roots/media-root-repository.js";
import { CatalogScanWriter } from "../writer/catalog-scan-writer.js";
import type { ScanStatus } from "../contracts.js";
import { CatalogScanner } from "./catalog-scanner.js";
import { ConcurrencyLimitedProber } from "./concurrency-limited-prober.js";
import { isRunning } from "./scan-job.js";
import { ControlledProber } from "../../testing/controlled-prober.js";
import {
  discoveredFiles,
  PROBE_RESULT,
  type Discover,
} from "../../testing/discovery-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { sequentialIds } from "../../testing/record-sources.js";
import { flushMicrotasks } from "../../testing/flush-microtasks.js";
import { recordingLog } from "../../testing/recording-log.js";
import { createBarrier } from "../../testing/test-barrier.js";
import { withoutTmdbKey } from "../../testing/scan-metadata.js";

const OTHER_ROOT_ID = "root-fixture-002";

afterEach(cleanUpTestEnvironment);

function path(name: string): string {
  return `/media/movies/${name}.mkv`;
}

interface SetupOptions {
  /** A fake discovery function, or "real" to walk the actual filesystem. */
  discover?: Discover | "real";
  concurrency?: number;
  /** Replaces the schedule pass that follows a completed commit. */
  ensureAllEnabled?: () => Promise<void>;
  /** Replaces the purge that follows a completed commit. */
  purge?: () => Promise<void>;
}

// Wires the real writer and repository against a seeded temporary database.
async function setup(options: SetupOptions = {}) {
  const database = await openTestDatabase();
  await database.db
    .insertInto("media_roots")
    .values([
      rootFixture,
      {
        ...rootFixture,
        id: OTHER_ROOT_ID,
        path: "/media/tv",
        path_key: "/media/tv",
      },
    ])
    .execute();
  await database.db.insertInto("media_items").values(itemFixture).execute();

  const prober = new ControlledProber();
  // Each read advances one second, so timestamps reveal the order of clock reads.
  let time = FIXTURE_TIME;
  const discover = vi.fn<Discover>(
    options.discover === "real"
      ? discoverMediaFiles
      : (options.discover ?? (async () => discoveredFiles("a", "b", "c"))),
  );
  const schedules = {
    ensureAllEnabled: vi.fn(options.ensureAllEnabled ?? (async () => {})),
  };
  const removals = { purge: vi.fn(options.purge ?? (async () => {})) };
  const log = recordingLog();
  const scanner = new CatalogScanner({
    metadata: withoutTmdbKey(),
    roots: new MediaRootRepository(database.db),
    prober: new ConcurrencyLimitedProber(prober, options.concurrency ?? 4),
    writer: new CatalogScanWriter(database.db, {
      createId: sequentialIds("item"),
    }),
    schedules,
    removals,
    log,
    discover,
    now: () => (time += 1_000),
  });
  return {
    db: database.db,
    scanner,
    prober,
    discover,
    schedules,
    removals,
    log,
  };
}

type Db = Awaited<ReturnType<typeof setup>>["db"];

async function catalogSnapshot(db: Db) {
  return {
    items: await db
      .selectFrom("media_items")
      .selectAll()
      .orderBy("id")
      .execute(),
    roots: await db
      .selectFrom("media_roots")
      .selectAll()
      .orderBy("id")
      .execute(),
  };
}

// Starts a job and fails the test unless the scanner accepted it.
async function start(scanner: CatalogScanner, rootId = rootFixture.id) {
  const result = await scanner.start(rootId);
  if (result.kind !== "started") {
    throw new Error(`Scan refused: ${result.kind}`);
  }
  return result.status;
}

// Waits until the root's job is terminal and returns that status.
function finished(
  scanner: CatalogScanner,
  rootId = rootFixture.id,
): Promise<ScanStatus> {
  return vi.waitFor(
    () => {
      const status = scanner.status(rootId);
      if (status === undefined || isRunning(status)) {
        throw new Error(`Scan of ${rootId} is ${status?.phase ?? "absent"}`);
      }
      return status;
    },
    { interval: 1, timeout: 2_000 },
  );
}

describe("CatalogScanner", () => {
  it("probes every discovered file and commits one generation with a summary", async () => {
    const { db, scanner, prober, schedules } = await setup();

    await start(scanner);
    await prober.waitForStarted(3);
    // Completion order differs from identity order on purpose.
    prober.get(path("c")).resolve(PROBE_RESULT);
    prober
      .get(path("a"))
      .reject(
        new MediaProbeError("invalid_json", "ffprobe returned malformed JSON"),
      );
    prober.get(path("b")).resolve({
      durationMs: 3_000,
      hasAudio: false,
      hasVideo: true,
    });

    expect(await finished(scanner)).toEqual({
      id: expect.any(String),
      rootId: rootFixture.id,
      phase: "completed",
      startedAt: FIXTURE_TIME + 1_000,
      finishedAt: FIXTURE_TIME + 6_000,
      discoveredCount: 3,
      settledCount: 3,
      probeFailedCount: 1,
      currentPath: null,
      lookupCount: 0,
      lookedUpCount: 0,
      currentTitle: null,
      cancelRequested: false,
      summary: {
        rootId: rootFixture.id,
        startedAt: FIXTURE_TIME + 1_000,
        completedAt: FIXTURE_TIME + 5_000,
        discoveredCount: 3,
        probedCount: 2,
        probeFailedCount: 1,
        missingCount: 1,
        matchedCount: 0,
        ambiguousCount: 0,
        unmatchedCount: 0,
        lookupErrorCount: 0,
      },
      error: null,
    });
    expect(schedules.ensureAllEnabled).toHaveBeenCalledTimes(1);

    const rows = await db
      .selectFrom("media_items")
      .select([
        "id",
        "path",
        "status",
        "duration_ms",
        "probe_error",
        "last_probed_at",
      ])
      .orderBy("id")
      .execute();
    // IDs follow identity order although probes finished c, a, b (probe times +2s, +3s, +4s).
    expect(rows).toEqual([
      {
        id: "item-001",
        path: path("a"),
        status: "probe_failed",
        duration_ms: null,
        probe_error: "invalid_json: ffprobe returned malformed JSON",
        last_probed_at: FIXTURE_TIME + 3_000,
      },
      {
        id: "item-002",
        path: path("b"),
        status: "available",
        duration_ms: 3_000,
        probe_error: null,
        last_probed_at: FIXTURE_TIME + 4_000,
      },
      {
        id: "item-003",
        path: path("c"),
        status: "available",
        duration_ms: 2_000,
        probe_error: null,
        last_probed_at: FIXTURE_TIME + 2_000,
      },
      {
        id: itemFixture.id,
        path: itemFixture.path,
        status: "missing",
        duration_ms: itemFixture.duration_ms,
        probe_error: null,
        last_probed_at: itemFixture.last_probed_at,
      },
    ]);
  });

  it("writes nothing to the catalog until every probe has finished", async () => {
    const { db, scanner, prober } = await setup();
    const before = await catalogSnapshot(db);

    await start(scanner);
    await prober.waitForStarted(3);
    prober.get(path("a")).resolve(PROBE_RESULT);
    prober.get(path("b")).resolve(PROBE_RESULT);
    await flushMicrotasks(10);

    expect(await catalogSnapshot(db)).toEqual(before);
    prober.get(path("c")).resolve(PROBE_RESULT);
    expect(await finished(scanner)).toMatchObject({ phase: "completed" });
  });

  it("reports an unknown root without discovery or a job", async () => {
    const { scanner, discover } = await setup();

    await expect(scanner.start("root-unknown")).resolves.toEqual({
      kind: "root_not_found",
    });
    expect(discover).not.toHaveBeenCalled();
    expect(scanner.status("root-unknown")).toBeUndefined();
  });

  it("rejects a disabled root without traversing the filesystem", async () => {
    const { db, scanner, discover } = await setup();
    await db
      .updateTable("media_roots")
      .set({ enabled: 0 })
      .where("id", "=", rootFixture.id)
      .execute();

    await expect(scanner.start(rootFixture.id)).resolves.toEqual({
      kind: "root_disabled",
    });
    expect(discover).not.toHaveBeenCalled();
    expect(scanner.status(rootFixture.id)).toBeUndefined();
  });

  it("rejects a second scan of a running root and accepts one after it ends", async () => {
    const { scanner, prober, discover } = await setup();

    const first = await start(scanner);
    await prober.waitForStarted(3);

    await expect(scanner.start(rootFixture.id)).resolves.toEqual({
      kind: "scan_in_progress",
    });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(prober.started).toHaveLength(3);

    prober.resolveAll(PROBE_RESULT);
    expect(await finished(scanner)).toMatchObject({
      id: first.id,
      phase: "completed",
    });
    // A terminal job no longer blocks the next scan of its root.
    const again = await start(scanner);
    expect(again.id).not.toBe(first.id);
    await prober.waitForStarted(6);
    prober.resolveAll(PROBE_RESULT);
    expect(await finished(scanner)).toMatchObject({
      id: again.id,
      phase: "completed",
    });
  });

  it("returns copies, so a reader cannot change a job", async () => {
    const { scanner, prober } = await setup();

    const started = await start(scanner);
    started.phase = "completed";
    scanner.status(rootFixture.id)!.cancelRequested = true;

    expect(scanner.status(rootFixture.id)).toMatchObject({
      finishedAt: null,
      cancelRequested: false,
    });
    expect(scanner.status(rootFixture.id)?.phase).not.toBe("completed");
    await prober.waitForStarted(3);
    prober.resolveAll(PROBE_RESULT);
    await finished(scanner);
  });

  it("scans different roots concurrently within one shared probe limit", async () => {
    const { scanner, prober } = await setup({
      concurrency: 2,
      discover: async (rootPath) =>
        ["a", "b", "c"].map((name) => ({
          path: `${rootPath}/${name}.mkv`,
          pathKey: `${rootPath}/${name}.mkv`,
          title: name,
        })),
    });

    await start(scanner, rootFixture.id);
    await start(scanner, OTHER_ROOT_ID);
    await prober.waitForStarted(2);
    await flushMicrotasks(10);
    expect(prober.active).toBe(2);

    // The media adapter settles a timed-out probe only after its child closes,
    // so until then the probe is pending here and must keep holding its slot.
    const terminating = prober.started[0];
    await flushMicrotasks(10);
    expect(prober.started).toHaveLength(2);
    terminating.reject(new MediaProbeError("timed_out", "ffprobe timed out"));

    while (prober.active > 0) {
      prober.resolveAll(PROBE_RESULT);
      await flushMicrotasks(10);
    }

    expect(await finished(scanner, rootFixture.id)).toMatchObject({
      phase: "completed",
    });
    expect(await finished(scanner, OTHER_ROOT_ID)).toMatchObject({
      phase: "completed",
    });
    expect(prober.started).toHaveLength(6);
    expect(prober.maxActive).toBe(2);
  });

  it("queues a large root without a false listener-leak warning", async () => {
    const names = Array.from(
      { length: 20 },
      (_, i) => `file-${String(i).padStart(2, "0")}`,
    );
    const { scanner, prober } = await setup({
      concurrency: 1,
      discover: async () => discoveredFiles(...names),
    });
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("warning", onWarning);

    try {
      await start(scanner);
      // With one slot, each round finishes the running probe and lets the next start.
      while (scanner.status(rootFixture.id)?.phase !== "completed") {
        prober.resolveAll(PROBE_RESULT);
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(scanner.status(rootFixture.id)).toMatchObject({
        summary: { discoveredCount: 20 },
      });
      // Process warnings are emitted on a later tick.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", onWarning);
    }

    expect(warnings.map((warning) => warning.name)).not.toContain(
      "MaxListenersExceededWarning",
    );
  });

  it("reports an inaccessible root through real discovery without changing the catalog", async () => {
    const { db, scanner } = await setup({ discover: "real" });
    await db
      .updateTable("media_roots")
      .set({ path: join(tmpdir(), "krazitv-never-created", "Movies") })
      .where("id", "=", rootFixture.id)
      .execute();
    const before = await catalogSnapshot(db);

    await start(scanner);

    expect(await finished(scanner)).toMatchObject({
      phase: "failed",
      error: {
        code: "media_root_unavailable",
        message: expect.stringContaining("Media root does not exist"),
      },
    });
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("cancels active and queued probes, waiting for active children to close", async () => {
    const { db, scanner, prober } = await setup({ concurrency: 1 });
    const before = await catalogSnapshot(db);

    await start(scanner);
    await prober.waitForStarted(1);

    expect(scanner.cancel(rootFixture.id)).toMatchObject({
      phase: "probing",
      cancelRequested: true,
    });
    await flushMicrotasks(10);
    expect(prober.get(path("a")).signal?.aborted).toBe(true);
    // The active child has not closed yet, so the job must not be terminal.
    expect(scanner.status(rootFixture.id)?.phase).toBe("probing");

    prober.rejectCancelled(path("a"));
    expect(await finished(scanner)).toMatchObject({
      phase: "cancelled",
      settledCount: 0,
      currentPath: null,
    });
    // Queued files never started a child.
    expect(prober.started.map((probe) => probe.path)).toEqual([path("a")]);
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("does not commit when cancelled after the last probe settles", async () => {
    const { db, scanner, prober, schedules } = await setup();
    const before = await catalogSnapshot(db);

    await start(scanner);
    await prober.waitForStarted(3);
    prober.resolveAll(PROBE_RESULT);
    scanner.cancel(rootFixture.id);

    expect(await finished(scanner)).toMatchObject({ phase: "cancelled" });
    expect(schedules.ensureAllEnabled).not.toHaveBeenCalled();
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("purges removed media after a completed commit, before the schedule pass", async () => {
    const calls: string[] = [];
    const { scanner, prober } = await setup({
      purge: async () => void calls.push("purge"),
      ensureAllEnabled: async () => void calls.push("schedules"),
    });

    await start(scanner);
    await prober.waitForStarted(3);
    prober.resolveAll(PROBE_RESULT);

    expect(await finished(scanner)).toMatchObject({ phase: "completed" });
    expect(calls).toEqual(["purge", "schedules"]);
  });

  it("fails without committing or purging for a root removed during the scan", async () => {
    const { db, scanner, prober, removals } = await setup();

    await start(scanner);
    await prober.waitForStarted(3);
    // A removal that passed its scan check before this scan was admitted.
    await db
      .updateTable("media_roots")
      .set({ removed_at: FIXTURE_TIME })
      .where("id", "=", rootFixture.id)
      .execute();
    const before = await catalogSnapshot(db);
    prober.resolveAll(PROBE_RESULT);

    expect(await finished(scanner)).toMatchObject({
      phase: "failed",
      summary: null,
      error: { code: "media_root_not_found" },
    });
    expect(await catalogSnapshot(db)).toEqual(before);
    expect(removals.purge).not.toHaveBeenCalled();
  });

  it("fails without committing for a root disabled during the scan", async () => {
    const { db, scanner, prober } = await setup();

    await start(scanner);
    await prober.waitForStarted(3);
    await db
      .updateTable("media_roots")
      .set({ enabled: 0 })
      .where("id", "=", rootFixture.id)
      .execute();
    const before = await catalogSnapshot(db);
    prober.resolveAll(PROBE_RESULT);

    expect(await finished(scanner)).toMatchObject({
      phase: "failed",
      summary: null,
      error: { code: "media_root_disabled" },
    });
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("fails the job on an unexpected probe error only after other probes settle", async () => {
    const { db, scanner, prober, log } = await setup();
    const before = await catalogSnapshot(db);

    await start(scanner);
    await prober.waitForStarted(3);

    prober.get(path("a")).reject(new TypeError("adapter bug"));
    await flushMicrotasks(10);
    expect(prober.get(path("b")).signal?.aborted).toBe(true);
    expect(scanner.status(rootFixture.id)?.phase).toBe("probing");

    prober.rejectCancelled(path("b"));
    prober.rejectCancelled(path("c"));
    expect(await finished(scanner)).toMatchObject({
      phase: "failed",
      error: { code: "scan_failed" },
    });
    expect(log.lines).toEqual([
      {
        level: "error",
        fields: expect.objectContaining({
          rootId: rootFixture.id,
          err: expect.objectContaining({ message: "adapter bug" }),
        }),
        message: expect.any(String),
      },
    ]);
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("shuts down by cancelling running jobs, waiting for them, and refusing new scans", async () => {
    const { db, scanner, prober } = await setup();
    const before = await catalogSnapshot(db);

    await start(scanner);
    await prober.waitForStarted(3);
    let shutDown = false;
    const shutdown = scanner.shutdown().then(() => {
      shutDown = true;
    });
    await flushMicrotasks(10);
    expect(prober.started.every((probe) => probe.signal?.aborted)).toBe(true);
    expect(shutDown).toBe(false);

    for (const name of ["a", "b", "c"]) prober.rejectCancelled(path(name));
    await shutdown;
    expect(scanner.status(rootFixture.id)).toMatchObject({
      phase: "cancelled",
      cancelRequested: true,
    });
    await expect(scanner.start(OTHER_ROOT_ID)).resolves.toEqual({
      kind: "shutting_down",
    });
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("lets a committing job finish its schedule pass before shutdown resolves", async () => {
    const schedulePass = createBarrier();
    const { scanner, prober } = await setup({
      ensureAllEnabled: () => schedulePass.wait(),
    });

    await start(scanner);
    await prober.waitForStarted(3);
    prober.resolveAll(PROBE_RESULT);
    await schedulePass.reached;
    let shutDown = false;
    const shutdown = scanner.shutdown().then(() => {
      shutDown = true;
    });
    await flushMicrotasks(10);
    expect(shutDown).toBe(false);
    expect(scanner.status(rootFixture.id)).toMatchObject({
      phase: "committing",
      cancelRequested: false,
    });

    schedulePass.release();
    await shutdown;
    expect(scanner.status(rootFixture.id)?.phase).toBe("completed");
  });
});
