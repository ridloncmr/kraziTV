// Spec 0002 acceptance: the whole catalog slice over HTTP, a real temporary
// SQLite file, and a real media directory. Only ffprobe is replaced.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, sep } from "node:path";

import { MediaProbeError, type MediaProbeResult } from "@krazitv/media";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { ControlledProber } from "../testing/controlled-prober.js";
import {
  closeTestServers,
  createTemporaryDirectory,
  startTestServer,
} from "../testing/test-server.js";
import { CatalogScanWriter } from "./writer/catalog-scan-writer.js";
import { CatalogScanner } from "./scanner/catalog-scanner.js";
import { ConcurrencyLimitedProber } from "./scanner/concurrency-limited-prober.js";

interface RunningServer {
  server: FastifyInstance;
  prober: ControlledProber;
}

type ProbeOutcome = MediaProbeResult | MediaProbeError;

const probers: ControlledProber[] = [];

afterEach(async () => {
  // A failed assertion can leave probes pending, and shutdown waits for them, so
  // cancel them first; otherwise the test hangs and SQLite keeps the directory locked.
  for (const probe of probers.splice(0).flatMap((prober) => prober.started)) {
    probe.reject(new MediaProbeError("cancelled", "ffprobe was cancelled"));
  }
  await closeTestServers();
});

// Composes the server the way index.ts does, swapping only ffprobe for a controlled double.
async function startServer(dataDirectory: string): Promise<RunningServer> {
  const prober = new ControlledProber();
  const { server } = await startTestServer({
    dataDirectory,
    overrides: (db, { mediaRoots }) => ({
      scanner: new CatalogScanner({
        roots: mediaRoots,
        prober: new ConcurrencyLimitedProber(prober, 4),
        writer: new CatalogScanWriter(db),
      }),
    }),
  });
  probers.push(prober);
  return { server, prober };
}

// Triggers a scan and settles each file's probe with the outcome chosen by filename.
async function scan(
  { server, prober }: RunningServer,
  rootId: string,
  outcomes: Record<string, ProbeOutcome> = {},
) {
  const alreadyStarted = prober.started.length;
  const response = server.inject({
    method: "POST",
    url: `/media-roots/${rootId}/scan`,
  });
  await prober.waitForStarted(alreadyStarted + Object.keys(outcomes).length);
  for (const probe of prober.started.slice(alreadyStarted)) {
    const outcome = outcomes[basename(probe.path)];
    if (outcome === undefined)
      throw new Error(`Unexpected probe ${probe.path}`);
    if (outcome instanceof MediaProbeError) probe.reject(outcome);
    else probe.resolve(outcome);
  }
  return response;
}

// Reads the public catalog projection, which is what later slices will consume.
async function listItems({ server }: RunningServer) {
  const response = await server.inject({ method: "GET", url: "/media-items" });
  expect(response.statusCode).toBe(200);
  return response.json();
}

// Reads the public root projection, including each root's last successful scan time.
async function listRoots({ server }: RunningServer) {
  const response = await server.inject({ method: "GET", url: "/media-roots" });
  return response.json();
}

describe("media catalog acceptance", () => {
  it("builds, persists, reconciles, and protects the catalog end to end", async () => {
    const workspace = await createTemporaryDirectory();
    const dataDirectory = join(workspace, "data");
    const mediaDirectory = join(workspace, "Movies");
    await mkdir(mediaDirectory);
    for (const name of ["Alpha.mkv", "Bravo.mp4", "Charlie.mkv"]) {
      await writeFile(join(mediaDirectory, name), "not really media");
    }

    // Create a root and scan it: every discovered file becomes an available item.
    const first = await startServer(dataDirectory);
    const created = await first.server.inject({
      method: "POST",
      url: "/media-roots",
      payload: { path: mediaDirectory },
    });
    expect(created.statusCode).toBe(201);
    const rootId: string = created.json().id;

    const firstScan = await scan(first, rootId, {
      "Alpha.mkv": { durationMs: 1_000, hasAudio: true },
      "Bravo.mp4": { durationMs: 2_000, hasAudio: false },
      "Charlie.mkv": { durationMs: 3_000, hasAudio: true },
    });
    expect(firstScan.statusCode).toBe(200);
    expect(firstScan.json()).toMatchObject({
      rootId,
      discoveredCount: 3,
      probedCount: 3,
      probeFailedCount: 0,
      missingCount: 0,
    });
    const scanned = await listItems(first);
    expect(scanned).toEqual([
      expect.objectContaining({
        mediaRootId: rootId,
        path: join(mediaDirectory, "Alpha.mkv"),
        title: "Alpha",
        durationMs: 1_000,
        hasAudio: true,
        status: "available",
      }),
      expect.objectContaining({
        title: "Bravo",
        durationMs: 2_000,
        hasAudio: false,
        status: "available",
      }),
      expect.objectContaining({
        title: "Charlie",
        durationMs: 3_000,
        hasAudio: true,
        status: "available",
      }),
    ]);

    // Restart on the same database file: the catalog is unchanged.
    await first.server.close();
    const second = await startServer(dataDirectory);
    expect(await listItems(second)).toEqual(scanned);

    // Remove one file and fail another's probe: the removed item goes missing and
    // both keep their last known metadata; the healthy file picks up new metadata.
    await rm(join(mediaDirectory, "Charlie.mkv"));
    const rescan = await scan(second, rootId, {
      "Alpha.mkv": { durationMs: 1_500, hasAudio: true },
      "Bravo.mp4": new MediaProbeError("timed_out", "ffprobe timed out"),
    });
    expect(rescan.statusCode).toBe(200);
    expect(rescan.json()).toMatchObject({
      discoveredCount: 2,
      probedCount: 1,
      probeFailedCount: 1,
      missingCount: 1,
    });
    const reconciled = await listItems(second);
    expect(reconciled).toEqual([
      expect.objectContaining({
        title: "Alpha",
        durationMs: 1_500,
        status: "available",
        probeError: null,
      }),
      expect.objectContaining({
        title: "Bravo",
        durationMs: 2_000,
        hasAudio: false,
        status: "probe_failed",
        probeError: "timed_out: ffprobe timed out",
      }),
      expect.objectContaining({
        title: "Charlie",
        durationMs: 3_000,
        hasAudio: true,
        status: "missing",
      }),
    ]);
    // Item identity survives reconciliation.
    expect(reconciled.map(({ id }: { id: string }) => id)).toEqual(
      scanned.map(({ id }: { id: string }) => id),
    );

    // The same directory cannot be registered twice.
    const duplicate = await second.server.inject({
      method: "POST",
      url: "/media-roots",
      payload: { path: `${mediaDirectory}${sep}` },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("media_root_duplicate");

    // A disabled root refuses to scan and leaves the catalog alone.
    const setEnabled = (enabled: boolean) =>
      second.server.inject({
        method: "PATCH",
        url: `/media-roots/${rootId}`,
        payload: { enabled },
      });
    expect((await setEnabled(false)).statusCode).toBe(200);
    const disabledScan = await scan(second, rootId);
    expect(disabledScan.statusCode).toBe(409);
    expect(disabledScan.json().error.code).toBe("media_root_disabled");
    expect(await listItems(second)).toEqual(reconciled);

    // A root that went offline fails its scan without marking anything missing.
    expect((await setEnabled(true)).statusCode).toBe(200);
    const rootsBefore = await listRoots(second);
    // Removed rather than renamed: rm retries while Windows briefly holds new files.
    await rm(mediaDirectory, { recursive: true, maxRetries: 5 });
    const offlineScan = await scan(second, rootId);
    expect(offlineScan.statusCode).toBe(409);
    expect(offlineScan.json().error.code).toBe("media_root_unavailable");
    expect(await listItems(second)).toEqual(reconciled);
    expect(await listRoots(second)).toEqual(rootsBefore);
  });
});
