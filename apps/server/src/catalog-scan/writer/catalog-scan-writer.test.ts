import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import {
  FIXTURE_TIME,
  insertTitledItems,
  itemFixture,
  rootFixture,
  titledItemFixture,
} from "../../testing/catalog-fixtures.js";
import type { CatalogCandidate } from "../contracts.js";
import { CatalogScanWriter } from "./catalog-scan-writer.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { countQueries } from "../../testing/query-counter.js";
import { sequentialIds } from "../../testing/record-sources.js";

const SCANNED_AT = FIXTURE_TIME + 60_000;
const PROBED_AT = FIXTURE_TIME + 30_000;

afterEach(cleanUpTestEnvironment);

// Opens a migrated database seeded with the fixture root and one available item.
async function setup() {
  const database = await openTestDatabase();
  await database.db.insertInto("media_roots").values(rootFixture).execute();
  await database.db.insertInto("media_items").values(itemFixture).execute();
  const writer = new CatalogScanWriter(database.db, {
    createId: sequentialIds("item"),
  });
  return { db: database.db, writer };
}

function available(
  name: string,
  overrides: Partial<CatalogCandidate> = {},
): CatalogCandidate {
  return {
    path: `/media/movies/${name}.mkv`,
    pathKey: `/media/movies/${name}.mkv`,
    title: name,
    probedAt: PROBED_AT,
    status: "available",
    durationMs: 1_234,
    hasAudio: false,
    hasVideo: true,
    ...overrides,
  } as CatalogCandidate;
}

function failed(
  name: string,
  probeError = "ffprobe timed out",
): CatalogCandidate {
  return {
    path: `/media/movies/${name}.mkv`,
    pathKey: `/media/movies/${name}.mkv`,
    title: name,
    probedAt: PROBED_AT,
    status: "probe_failed",
    probeError,
  };
}

async function items(db: Awaited<ReturnType<typeof setup>>["db"]) {
  return db.selectFrom("media_items").selectAll().orderBy("path_key").execute();
}

async function lastScannedAt(db: Awaited<ReturnType<typeof setup>>["db"]) {
  const root = await db
    .selectFrom("media_roots")
    .select("last_scanned_at")
    .where("id", "=", rootFixture.id)
    .executeTakeFirstOrThrow();
  return root.last_scanned_at;
}

describe("CatalogScanWriter", () => {
  it("inserts new items, updates rediscovered items, and records the scan time", async () => {
    const { db, writer } = await setup();

    const result = await writer.commit({
      rootId: rootFixture.id,
      scannedAt: SCANNED_AT,
      candidates: [
        available("example", {
          durationMs: 7_300_000,
          hasAudio: false,
          hasVideo: false,
        }),
        available("new-film"),
        failed("broken"),
      ],
    });

    expect(result).toEqual({ kind: "committed", missingCount: 0 });
    expect(await lastScannedAt(db)).toBe(SCANNED_AT);
    expect(await items(db)).toEqual([
      {
        id: "item-002",
        media_root_id: rootFixture.id,
        path: "/media/movies/broken.mkv",
        path_key: "/media/movies/broken.mkv",
        title: "broken",
        duration_ms: null,
        has_audio: null,
        has_video: null,
        status: "probe_failed",
        probe_error: "ffprobe timed out",
        created_at: SCANNED_AT,
        updated_at: SCANNED_AT,
        last_seen_at: SCANNED_AT,
        last_probed_at: PROBED_AT,
      },
      {
        ...itemFixture,
        title: "example",
        duration_ms: 7_300_000,
        has_audio: 0,
        has_video: 0,
        updated_at: SCANNED_AT,
        last_seen_at: SCANNED_AT,
        last_probed_at: PROBED_AT,
      },
      {
        id: "item-001",
        media_root_id: rootFixture.id,
        path: "/media/movies/new-film.mkv",
        path_key: "/media/movies/new-film.mkv",
        title: "new-film",
        duration_ms: 1_234,
        has_audio: 0,
        has_video: 1,
        status: "available",
        probe_error: null,
        created_at: SCANNED_AT,
        updated_at: SCANNED_AT,
        last_seen_at: SCANNED_AT,
        last_probed_at: PROBED_AT,
      },
    ]);
  });

  it("keeps last known metadata when a previously probed item now fails", async () => {
    const { db, writer } = await setup();

    await writer.commit({
      rootId: rootFixture.id,
      scannedAt: SCANNED_AT,
      candidates: [failed("example", "ffprobe exited with code 1")],
    });

    const [item] = await items(db);
    expect(item).toMatchObject({
      status: "probe_failed",
      probe_error: "ffprobe exited with code 1",
      duration_ms: itemFixture.duration_ms,
      has_audio: itemFixture.has_audio,
      last_probed_at: PROBED_AT,
    });
  });

  it("clears the probe error when a failed item later probes successfully", async () => {
    const { db, writer } = await setup();
    await writer.commit({
      rootId: rootFixture.id,
      scannedAt: SCANNED_AT,
      candidates: [failed("example")],
    });

    await writer.commit({
      rootId: rootFixture.id,
      scannedAt: SCANNED_AT + 1,
      candidates: [available("example")],
    });

    const [item] = await items(db);
    expect(item).toMatchObject({
      status: "available",
      probe_error: null,
      duration_ms: 1_234,
    });
  });

  it("marks unseen items missing, preserving their metadata, and counts only new transitions", async () => {
    const { db, writer } = await setup();

    const first = await writer.commit({
      rootId: rootFixture.id,
      scannedAt: SCANNED_AT,
      candidates: [],
    });
    const second = await writer.commit({
      rootId: rootFixture.id,
      scannedAt: SCANNED_AT + 1,
      candidates: [],
    });

    expect(first).toEqual({ kind: "committed", missingCount: 1 });
    expect(second).toEqual({ kind: "committed", missingCount: 0 });
    expect(await items(db)).toEqual([
      {
        ...itemFixture,
        status: "missing",
        updated_at: SCANNED_AT,
      },
    ]);
  });

  // An unmounted network share leaves an empty mount point, so a whole large
  // library can go missing in one scan.
  it("marks more items missing at once than SQLite binds parameters in one statement", async () => {
    const { db, writer } = await setup();
    const count = 33_000;
    await insertTitledItems(
      db,
      Array.from(
        { length: count },
        (_, index) => `bulk-${String(index).padStart(5, "0")}`,
      ),
    );

    const result = await writer.commit({
      rootId: rootFixture.id,
      scannedAt: SCANNED_AT,
      candidates: [],
    });

    expect(result).toEqual({ kind: "committed", missingCount: count + 1 });
    const { remaining } = await db
      .selectFrom("media_items")
      .select((eb) => eb.fn.countAll<number>().as("remaining"))
      .where("status", "!=", "missing")
      .executeTakeFirstOrThrow();
    expect(remaining).toBe(0);
  });

  it("restores a rediscovered missing item from its new probe result", async () => {
    const { db, writer } = await setup();
    await writer.commit({
      rootId: rootFixture.id,
      scannedAt: SCANNED_AT,
      candidates: [],
    });

    await writer.commit({
      rootId: rootFixture.id,
      scannedAt: SCANNED_AT + 1,
      candidates: [failed("example")],
    });

    const [item] = await items(db);
    expect(item).toMatchObject({
      status: "probe_failed",
      duration_ms: itemFixture.duration_ms,
      last_seen_at: SCANNED_AT + 1,
    });
  });

  it("never reconciles or deduplicates items belonging to another root", async () => {
    const { db, writer } = await setup();
    await db
      .insertInto("media_roots")
      .values({
        ...rootFixture,
        id: "root-overlap",
        path: "/media",
        path_key: "/media",
      })
      .execute();

    await writer.commit({
      rootId: "root-overlap",
      scannedAt: SCANNED_AT,
      candidates: [available("example")],
    });

    const rows = await db
      .selectFrom("media_items")
      .select(["id", "media_root_id", "status"])
      .orderBy("id")
      .execute();
    expect(rows).toEqual([
      { id: "item-001", media_root_id: "root-overlap", status: "available" },
      {
        id: itemFixture.id,
        media_root_id: rootFixture.id,
        status: "available",
      },
    ]);
  });

  it("refuses to commit for a root disabled before finalization", async () => {
    const { db, writer } = await setup();
    await db
      .updateTable("media_roots")
      .set({ enabled: 0 })
      .where("id", "=", rootFixture.id)
      .execute();

    const result = await writer.commit({
      rootId: rootFixture.id,
      scannedAt: SCANNED_AT,
      candidates: [],
    });

    expect(result).toEqual({ kind: "root_disabled" });
    expect(await items(db)).toEqual([itemFixture]);
    expect(await lastScannedAt(db)).toBeNull();
  });

  it("reports a root deleted before finalization as not found", async () => {
    const { writer } = await setup();

    await expect(
      writer.commit({
        rootId: "root-gone",
        scannedAt: SCANNED_AT,
        candidates: [],
      }),
    ).resolves.toEqual({ kind: "root_not_found" });
  });

  describe("batched commit", () => {
    // Three 1,000-row chunks, with the last chunk partly full so a writer
    // that only flushes full chunks would visibly drop rows.
    const CANDIDATE_COUNT = 2_500;
    const CHUNK_COUNT = 3;
    const names = Array.from(
      { length: CANDIDATE_COUNT },
      (_, index) => `batch-${String(index).padStart(5, "0")}`,
    );

    it("yields to the event loop between chunks inside the one transaction", async () => {
      const { db } = await setup();
      let upserts = 0;
      let upsertsWhenEventLoopRan: number | undefined;
      const counter = countQueries(db, (node) => {
        if (node.kind !== "InsertQueryNode") {
          return;
        }
        upserts += 1;
        if (upserts === 1) {
          setImmediate(() => {
            upsertsWhenEventLoopRan = upserts;
          });
        }
      });
      const writer = new CatalogScanWriter(counter.db, {
        createId: sequentialIds("item"),
      });

      await writer.commit({
        rootId: rootFixture.id,
        scannedAt: SCANNED_AT,
        candidates: names.map((name) => available(name)),
      });

      expect(upserts).toBe(CHUNK_COUNT);
      expect(upsertsWhenEventLoopRan).toBeLessThan(CHUNK_COUNT);
    });

    it("rolls back every earlier chunk when a later chunk fails", async () => {
      const { db, writer } = await setup();
      const lastPath = `/media/movies/${names.at(-1)}.mkv`;
      await sql`
        create trigger fail_last_chunk
        before insert on media_items
        when new.path_key = ${sql.lit(lastPath)}
        begin
          select raise(abort, 'simulated chunk failure');
        end
      `.execute(db);

      await expect(
        writer.commit({
          rootId: rootFixture.id,
          scannedAt: SCANNED_AT,
          candidates: names.map((name) => available(name)),
        }),
      ).rejects.toThrow(/simulated chunk failure/);

      expect(await items(db)).toEqual([itemFixture]);
      expect(await lastScannedAt(db)).toBeNull();
    });

    it("runs a number of statements bounded by chunk count, not candidate count", async () => {
      const { db } = await setup();
      await insertTitledItems(db, names.slice(0, 1_200));
      const counter = countQueries(db);
      const writer = new CatalogScanWriter(counter.db, {
        createId: sequentialIds("item"),
      });

      const result = await writer.commit({
        rootId: rootFixture.id,
        scannedAt: SCANNED_AT,
        candidates: names.map((name) => available(name)),
      });

      expect(result).toEqual({ kind: "committed", missingCount: 1 });
      // Root re-check, existing-row read, one upsert per chunk, one missing
      // update, and the root's scan time.
      expect(counter.count()).toBe(2 + CHUNK_COUNT + 1 + 1);
    });

    it("updates existing rows in place across chunks and keeps metadata when a probe fails", async () => {
      const { db, writer } = await setup();
      await insertTitledItems(db, names.slice(0, 1_500));
      const failedName = names[1_400];
      const updatedName = names[10];
      const newName = names[2_000];

      await writer.commit({
        rootId: rootFixture.id,
        scannedAt: SCANNED_AT,
        candidates: names.map((name) =>
          name === failedName ? failed(name) : available(name),
        ),
      });

      const rows = await items(db);
      const byTitle = new Map(rows.map((row) => [row.title, row]));
      expect(rows).toHaveLength(CANDIDATE_COUNT + 1);
      expect(byTitle.get(failedName)).toEqual({
        ...titledItemFixture(failedName),
        status: "probe_failed",
        probe_error: "ffprobe timed out",
        updated_at: SCANNED_AT,
        last_seen_at: SCANNED_AT,
        last_probed_at: PROBED_AT,
      });
      expect(byTitle.get(updatedName)).toEqual({
        ...titledItemFixture(updatedName),
        duration_ms: 1_234,
        has_audio: 0,
        has_video: 1,
        updated_at: SCANNED_AT,
        last_seen_at: SCANNED_AT,
        last_probed_at: PROBED_AT,
      });
      // IDs are drawn only for the 1,000 new path keys, in candidate order.
      expect(byTitle.get(names[1_500])?.id).toBe("item-001");
      expect(byTitle.get(newName)?.id).toBe("item-501");
      expect(byTitle.get(names.at(-1) ?? "")?.id).toBe("item-1000");
    });
  });

  it("rolls back item changes and lastScannedAt together when the transaction fails", async () => {
    const { db, writer } = await setup();
    await sql`
      create trigger fail_root_scan_update
      before update of last_scanned_at on media_roots
      begin
        select raise(abort, 'simulated commit failure');
      end
    `.execute(db);

    await expect(
      writer.commit({
        rootId: rootFixture.id,
        scannedAt: SCANNED_AT,
        candidates: [available("new-film")],
      }),
    ).rejects.toThrow(/simulated commit failure/);

    expect(await items(db)).toEqual([itemFixture]);
    expect(await lastScannedAt(db)).toBeNull();
  });
});
