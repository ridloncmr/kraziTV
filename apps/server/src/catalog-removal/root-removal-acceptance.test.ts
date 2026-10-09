// Spec 0010 acceptance: removing whole media roots over HTTP, and how scans,
// startup, and re-adding a path interact with removed rows.
import { tmpdir } from "node:os";
import { join } from "node:path";

import { currentPathPlatform, normalizeMediaPath } from "@krazitv/media";
import { afterEach, describe, expect, it } from "vitest";

import { CatalogScanner } from "../catalog-scan/scanner/catalog-scanner.js";
import { CatalogScanWriter } from "../catalog-scan/writer/catalog-scan-writer.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { iso, send, waitForScan } from "../testing/api-requests.js";
import { FIXTURE_TIME, rootFixture } from "../testing/catalog-fixtures.js";
import { ControlledProber } from "../testing/controlled-prober.js";
import { IdleMetadataRefresh } from "../testing/idle-metadata-refresh.js";
import {
  discoveredFiles,
  PROBE_RESULT,
} from "../testing/discovery-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import { recordingLog } from "../testing/recording-log.js";
import { seedScheduleScenario } from "../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../testing/schedule-server.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../testing/test-environment.js";
import { withoutTmdbKey } from "../testing/scan-metadata.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
// The IDs seedScheduleScenario writes; item-001 airs first, for 22 minutes.
const CHANNEL_ID = "channel-fixture-001";
const ROOT_ID = rootFixture.id;
const ROOT_TARGET = { target: { mediaRootId: ROOT_ID } };

describe("catalog removal of a media root", () => {
  it("removes the root and every item under it from every catalog read in one commit", async () => {
    const { server, clock } = await startScheduleScenarioServer();
    clock.advance(5 * MINUTE);

    const removal = await send(server, "POST", "/catalog-removals", {
      ...ROOT_TARGET,
      allowUnschedulable: true,
    });

    expect(removal).toEqual({
      status: 200,
      body: {
        removedItemCount: 3,
        finishing: [{ channelId: CHANNEL_ID, endsAt: iso(T0 + 22 * MINUTE) }],
        interruptedChannelIds: [],
        stopFailedChannelIds: [],
        affectedChannelIds: [CHANNEL_ID],
      },
    });
    await expect(send(server, "GET", "/media-roots")).resolves.toEqual({
      status: 200,
      body: [],
    });
    await expect(send(server, "GET", "/media-items")).resolves.toMatchObject({
      body: { items: [], total: 0 },
    });
    for (const [method, url, payload] of [
      ["PATCH", `/media-roots/${ROOT_ID}`, { enabled: false }],
      ["POST", `/media-roots/${ROOT_ID}/scan`, undefined],
      ["POST", "/catalog-removals", ROOT_TARGET],
    ] as const) {
      await expect(send(server, method, url, payload)).resolves.toMatchObject({
        status: 404,
        body: { error: { code: "media_root_not_found" } },
      });
    }
  });

  it.each(["/catalog-removals", "/catalog-removals/preview"])(
    "refuses an unknown root at %s",
    async (url) => {
      const { server } = await startScheduleScenarioServer();

      await expect(
        send(server, "POST", url, { target: { mediaRootId: "unknown" } }),
      ).resolves.toMatchObject({
        status: 404,
        body: { error: { code: "media_root_not_found" } },
      });
    },
  );

  it("refuses to remove a root, or its items, while the root is being scanned", async () => {
    const prober = new ControlledProber();
    const { server } = await startTestServer({
      seed: (db) =>
        seedScheduleScenario(db, {
          items: [{ durationMs: 22 * MINUTE }],
          source: null,
        }).then(() => undefined),
      overrides: (db, { mediaRoots, schedules, catalogRemovals }) => ({
        scanner: new CatalogScanner({
          metadata: withoutTmdbKey(),
          roots: mediaRoots,
          prober,
          writer: new CatalogScanWriter(db),
          discover: async () => discoveredFiles("a"),
          schedules,
          removals: catalogRemovals,
          metadataRefresh: new IdleMetadataRefresh(),
          log: recordingLog(),
        }),
      }),
    });
    await send(server, "POST", `/media-roots/${ROOT_ID}/scan`);
    await prober.waitForStarted(1);

    for (const target of [
      { mediaRootId: ROOT_ID },
      { mediaItemIds: ["item-001"] },
    ]) {
      await expect(
        send(server, "POST", "/catalog-removals", { target }),
      ).resolves.toMatchObject({
        status: 409,
        body: { error: { code: "scan_in_progress" } },
      });
    }
    prober.resolveAll(PROBE_RESULT);
    await expect(waitForScan(server, ROOT_ID)).resolves.toMatchObject({
      phase: "completed",
    });
  });
});

describe("re-adding a removed root's path", () => {
  // A path the host platform accepts as absolute, given to the fixture root.
  const rootPath = join(tmpdir(), "krazitv-never-created", "movies");

  it("waits while an airing entry holds the old root's items, then replaces the root", async () => {
    const { server, db, clock } = await startScheduleScenarioServer();
    const normalized = normalizeMediaPath(rootPath, currentPathPlatform());
    await db
      .updateTable("media_roots")
      .set({ path: normalized!.path, path_key: normalized!.pathKey })
      .execute();
    clock.advance(5 * MINUTE);
    await send(server, "POST", "/catalog-removals", {
      ...ROOT_TARGET,
      allowUnschedulable: true,
    });

    await expect(
      send(server, "POST", "/media-roots", { path: rootPath }),
    ).resolves.toMatchObject({
      status: 409,
      body: {
        error: {
          code: "media_root_removal_pending",
          airingUntil: iso(T0 + 22 * MINUTE),
        },
      },
    });

    clock.set(T0 + 22 * MINUTE);
    const created = await send(server, "POST", "/media-roots", {
      path: rootPath,
    });

    expect(created).toMatchObject({
      status: 201,
      body: { path: normalized!.path },
    });
    expect((created.body as { id: string }).id).not.toBe(ROOT_ID);
    await expect(
      db.selectFrom("media_roots").select("id").execute(),
    ).resolves.toEqual([{ id: (created.body as { id: string }).id }]);
    await expect(
      db.selectFrom("media_items").select("id").execute(),
    ).resolves.toEqual([]);
  });

  it("still refuses a path that a cataloged root holds", async () => {
    const { server, db } = await startScheduleScenarioServer();
    const normalized = normalizeMediaPath(rootPath, currentPathPlatform());
    await db
      .updateTable("media_roots")
      .set({ path: normalized!.path, path_key: normalized!.pathKey })
      .execute();

    await expect(
      send(server, "POST", "/media-roots", { path: rootPath }),
    ).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "media_root_duplicate" } },
    });
  });
});

describe("purge at startup", () => {
  it("purges removed rows whose airing entries ended while the server was down", async () => {
    const first = await startScheduleScenarioServer();
    first.clock.advance(5 * MINUTE);
    await send(first.server, "POST", "/catalog-removals", {
      target: { mediaItemIds: ["item-001"] },
    });
    await first.server.close();

    const clock = manualClock(T0 + 60 * MINUTE);
    const { server, db } = await startTestServer({
      dataDirectory: first.dataDirectory,
      overrides: (db) => ({
        schedules: new ScheduleService(db, {
          now: clock.now,
          createId: sequentialIds("restart-entry"),
        }),
      }),
    });
    await server.ready();

    await expect(
      db.selectFrom("media_items").select("id").orderBy("id").execute(),
    ).resolves.toEqual([{ id: "item-002" }, { id: "item-003" }]);
    await expect(
      db
        .selectFrom("schedule_entries")
        .select("id")
        .where("media_item_id", "=", "item-001")
        .execute(),
    ).resolves.toEqual([]);
  });
});
