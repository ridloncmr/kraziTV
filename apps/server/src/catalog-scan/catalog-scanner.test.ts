import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  discoverMediaFiles,
  MediaDiscoveryError,
  MediaProbeError,
  type DiscoveredMediaFile,
  type DiscoverMediaFilesOptions,
} from "@krazitv/media";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openDatabase, type KraziDatabase } from "../database/database.js";
import {
  FIXTURE_TIME,
  itemFixture,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import { MediaRootRepository } from "../media-roots/media-root-repository.js";
import { CatalogScanWriter } from "./catalog-scan-writer.js";
import { CatalogScanner } from "./catalog-scanner.js";
import { ConcurrencyLimitedProber } from "./concurrency-limited-prober.js";
import { ControlledProber } from "../testing/controlled-prober.js";

const OTHER_ROOT_ID = "root-fixture-002";
const RESULT = { durationMs: 2_000, hasAudio: true };

type Discover = (
  rootPath: string,
  options?: DiscoverMediaFilesOptions,
) => Promise<DiscoveredMediaFile[]>;

const databases: KraziDatabase[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

// Builds discovery output for files directly under the fixture root, in identity order.
function files(...names: string[]): DiscoveredMediaFile[] {
  return names.map((name) => ({
    path: `/media/movies/${name}.mkv`,
    pathKey: `/media/movies/${name}.mkv`,
    title: name,
  }));
}

function path(name: string): string {
  return `/media/movies/${name}.mkv`;
}

// Lets queued promise continuations run so assertions see settled scheduling.
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

interface SetupOptions {
  /** A fake discovery function, or "real" to walk the actual filesystem. */
  discover?: Discover | "real";
  concurrency?: number;
}

// Wires the real writer and repository against a seeded temporary database.
async function setup(options: SetupOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "krazitv-scanner-"));
  temporaryDirectories.push(directory);
  const database = await openDatabase({ dataDirectory: directory });
  databases.push(database);
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
  let nextId = 0;
  const discover = vi.fn<Discover>(
    options.discover === "real"
      ? discoverMediaFiles
      : (options.discover ?? (async () => files("a", "b", "c"))),
  );
  const scanner = new CatalogScanner({
    roots: new MediaRootRepository(database.db),
    prober: new ConcurrencyLimitedProber(prober, options.concurrency ?? 4),
    writer: new CatalogScanWriter(database.db, {
      createId: () => `item-${String(++nextId).padStart(3, "0")}`,
    }),
    discover,
    now: () => (time += 1_000),
  });
  return { db: database.db, scanner, prober, discover };
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

describe("CatalogScanner", () => {
  it("probes every discovered file and commits one generation with a summary", async () => {
    const { db, scanner, prober } = await setup();

    const scan = scanner.scan(rootFixture.id);
    await prober.waitForStarted(3);
    // Completion order differs from identity order on purpose.
    prober.get(path("c")).resolve(RESULT);
    prober
      .get(path("a"))
      .reject(
        new MediaProbeError("invalid_json", "ffprobe returned malformed JSON"),
      );
    prober.get(path("b")).resolve({ durationMs: 3_000, hasAudio: false });

    await expect(scan).resolves.toEqual({
      kind: "completed",
      summary: {
        rootId: rootFixture.id,
        startedAt: FIXTURE_TIME + 1_000,
        completedAt: FIXTURE_TIME + 5_000,
        discoveredCount: 3,
        probedCount: 2,
        probeFailedCount: 1,
        missingCount: 1,
      },
    });

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

    const scan = scanner.scan(rootFixture.id);
    await prober.waitForStarted(3);
    prober.get(path("a")).resolve(RESULT);
    prober.get(path("b")).resolve(RESULT);
    await flush();

    expect(await catalogSnapshot(db)).toEqual(before);
    prober.get(path("c")).resolve(RESULT);
    await expect(scan).resolves.toMatchObject({ kind: "completed" });
  });

  it("reports an unknown root without discovery", async () => {
    const { scanner, discover } = await setup();

    await expect(scanner.scan("root-unknown")).resolves.toEqual({
      kind: "root_not_found",
    });
    expect(discover).not.toHaveBeenCalled();
  });

  it("rejects a disabled root without traversing the filesystem", async () => {
    const { db, scanner, discover } = await setup();
    await db
      .updateTable("media_roots")
      .set({ enabled: 0 })
      .where("id", "=", rootFixture.id)
      .execute();

    await expect(scanner.scan(rootFixture.id)).resolves.toEqual({
      kind: "root_disabled",
    });
    expect(discover).not.toHaveBeenCalled();
  });

  it("rejects a second scan of the same root without discovery or probing", async () => {
    const { scanner, prober, discover } = await setup();

    const first = scanner.scan(rootFixture.id);
    await prober.waitForStarted(3);

    await expect(scanner.scan(rootFixture.id)).resolves.toEqual({
      kind: "scan_in_progress",
    });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(prober.started).toHaveLength(3);

    prober.resolveAll(RESULT);
    await expect(first).resolves.toMatchObject({ kind: "completed" });
    // The registry is released once the first scan settles.
    const again = scanner.scan(rootFixture.id);
    await prober.waitForStarted(6);
    prober.resolveAll(RESULT);
    await expect(again).resolves.toMatchObject({ kind: "completed" });
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

    const movies = scanner.scan(rootFixture.id);
    const tv = scanner.scan(OTHER_ROOT_ID);
    await prober.waitForStarted(2);
    await flush();
    expect(prober.active).toBe(2);

    // The media adapter settles a timed-out probe only after its child closes,
    // so until then the probe is pending here and must keep holding its slot.
    const terminating = prober.started[0]!;
    await flush();
    expect(prober.started).toHaveLength(2);
    terminating.reject(new MediaProbeError("timed_out", "ffprobe timed out"));

    while (prober.active > 0) {
      prober.resolveAll(RESULT);
      await flush();
    }

    await expect(movies).resolves.toMatchObject({ kind: "completed" });
    await expect(tv).resolves.toMatchObject({ kind: "completed" });
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
      discover: async () => files(...names),
    });
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("warning", onWarning);

    try {
      let settled = false;
      const scan = scanner.scan(rootFixture.id).finally(() => {
        settled = true;
      });
      // With one slot, each round finishes the running probe and lets the next start.
      while (!settled) {
        prober.resolveAll(RESULT);
        await new Promise((resolve) => setImmediate(resolve));
      }
      await expect(scan).resolves.toMatchObject({
        kind: "completed",
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

  it("preserves the previous catalog when the root cannot be traversed", async () => {
    const { db, scanner, prober } = await setup({
      discover: async (rootPath) => {
        throw new MediaDiscoveryError(
          "traversal_failed",
          `Could not read media path: ${rootPath}/Season 1`,
          `${rootPath}/Season 1`,
        );
      },
    });
    const before = await catalogSnapshot(db);

    const result = await scanner.scan(rootFixture.id);

    expect(result).toMatchObject({
      kind: "root_unavailable",
      error: { code: "traversal_failed" },
    });
    expect(prober.started).toHaveLength(0);
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("reports an inaccessible root through real discovery without changing the catalog", async () => {
    const { db, scanner } = await setup({ discover: "real" });
    await db
      .updateTable("media_roots")
      .set({ path: join(tmpdir(), "krazitv-never-created", "Movies") })
      .where("id", "=", rootFixture.id)
      .execute();
    const before = await catalogSnapshot(db);

    await expect(scanner.scan(rootFixture.id)).resolves.toMatchObject({
      kind: "root_unavailable",
      error: { code: "root_not_found" },
    });
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("does nothing for a request that was cancelled before scanning began", async () => {
    const { db, scanner, discover } = await setup();
    const before = await catalogSnapshot(db);

    await expect(
      scanner.scan(rootFixture.id, { signal: AbortSignal.abort() }),
    ).resolves.toEqual({ kind: "cancelled" });
    expect(discover).not.toHaveBeenCalled();
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("cancels during discovery without probing or committing", async () => {
    const { db, scanner, prober, discover } = await setup({
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
    const controller = new AbortController();
    const before = await catalogSnapshot(db);

    const scan = scanner.scan(rootFixture.id, { signal: controller.signal });
    await vi.waitFor(() => expect(discover).toHaveBeenCalled());
    controller.abort();

    await expect(scan).resolves.toEqual({ kind: "cancelled" });
    expect(prober.started).toHaveLength(0);
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("cancels active and queued probes, waiting for active children to close", async () => {
    const { db, scanner, prober } = await setup({ concurrency: 1 });
    const controller = new AbortController();
    const before = await catalogSnapshot(db);

    const scan = scanner.scan(rootFixture.id, { signal: controller.signal });
    await prober.waitForStarted(1);
    let settled = false;
    void scan.then(() => {
      settled = true;
    });

    controller.abort();
    await flush();
    expect(prober.get(path("a")).signal?.aborted).toBe(true);
    // The active child has not closed yet, so the scan must not settle.
    expect(settled).toBe(false);

    prober.rejectCancelled(path("a"));
    await expect(scan).resolves.toEqual({ kind: "cancelled" });
    // Queued files never started a child.
    expect(prober.started.map((probe) => probe.path)).toEqual([path("a")]);
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("does not commit when cancelled after the last probe settles", async () => {
    const { db, scanner, prober } = await setup();
    const controller = new AbortController();
    const before = await catalogSnapshot(db);

    const scan = scanner.scan(rootFixture.id, { signal: controller.signal });
    await prober.waitForStarted(3);
    prober.resolveAll(RESULT);
    controller.abort();

    await expect(scan).resolves.toEqual({ kind: "cancelled" });
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("does not commit a generation for a root disabled during the scan", async () => {
    const { db, scanner, prober } = await setup();

    const scan = scanner.scan(rootFixture.id);
    await prober.waitForStarted(3);
    await db
      .updateTable("media_roots")
      .set({ enabled: 0 })
      .where("id", "=", rootFixture.id)
      .execute();
    const before = await catalogSnapshot(db);
    prober.resolveAll(RESULT);

    await expect(scan).resolves.toEqual({ kind: "root_disabled" });
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("fails the scan on an unexpected probe error only after other probes settle", async () => {
    const { db, scanner, prober } = await setup();
    const before = await catalogSnapshot(db);

    const scan = scanner.scan(rootFixture.id);
    await prober.waitForStarted(3);
    let settled = false;
    void scan.catch(() => {
      settled = true;
    });

    prober.get(path("a")).reject(new TypeError("adapter bug"));
    await flush();
    expect(prober.get(path("b")).signal?.aborted).toBe(true);
    expect(settled).toBe(false);

    prober.rejectCancelled(path("b"));
    prober.rejectCancelled(path("c"));
    await expect(scan).rejects.toThrow("adapter bug");
    expect(await catalogSnapshot(db)).toEqual(before);
  });

  it("shuts down by cancelling active scans, waiting for them, and refusing new scans", async () => {
    const { db, scanner, prober } = await setup();
    const before = await catalogSnapshot(db);

    const scan = scanner.scan(rootFixture.id);
    await prober.waitForStarted(3);
    let shutDown = false;
    const shutdown = scanner.shutdown().then(() => {
      shutDown = true;
    });
    await flush();
    expect(prober.started.every((probe) => probe.signal?.aborted)).toBe(true);
    expect(shutDown).toBe(false);

    for (const name of ["a", "b", "c"]) prober.rejectCancelled(path(name));
    await shutdown;
    await expect(scan).resolves.toEqual({ kind: "cancelled" });
    await expect(scanner.scan(OTHER_ROOT_ID)).resolves.toEqual({
      kind: "cancelled",
    });
    expect(await catalogSnapshot(db)).toEqual(before);
  });
});
