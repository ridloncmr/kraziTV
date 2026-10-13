import { afterEach, describe, expect, it } from "vitest";
import { RecordingCollectionMaintenance } from "../../testing/recording-collection-maintenance.js";

import { CatalogRemovalService } from "../../catalog-removal/catalog-removal-service.js";
import type { ImmediateTransactionHooks } from "../../database/writes/immediate-transaction.js";
import { ScheduleService } from "../../schedules/schedule-service.js";
import {
  collectionFixture,
  FIXTURE_TIME,
} from "../../testing/catalog-fixtures.js";
import {
  channelFixture,
  programmingBlockFixture,
} from "../../testing/channel-fixtures.js";
import { seedEpisodes } from "../../testing/collection-fixtures.js";
import { manualClock } from "../../testing/manual-clock.js";
import { correctionRow } from "../../testing/metadata-match-fixtures.js";
import { recordingLog } from "../../testing/recording-log.js";
import { flushMicrotasks } from "../../testing/flush-microtasks.js";
import { createBarrier } from "../../testing/test-barrier.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { MediaCollectionRepository } from "../persistence/media-collection-repository.js";
import { CollectionMaintenance } from "./collection-maintenance.js";

afterEach(cleanUpTestEnvironment);

const OFFICE = { kind: "series", tmdbId: 2316 } as const;

/**
 * Catalogs two Office episodes, creates an automatic collection of them and
 * a manual snapshot of the same episodes, and builds the real service over
 * a manual clock. `failNextPass` makes the next pass's transaction throw,
 * and `beforePass` holds each pass before its transaction begins.
 */
async function setup(options: { beforePass?: () => Promise<void> } = {}) {
  const { db } = await openTestDatabase();
  await seedEpisodes(db, [
    ["e1", 1, 1],
    ["e2", 1, 2],
  ]);
  const clock = manualClock(FIXTURE_TIME);
  const failure: { next?: Error } = {};
  const transactionHooks: ImmediateTransactionHooks = {
    afterBegin: () => {
      const error = failure.next;
      failure.next = undefined;
      if (error !== undefined) throw error;
    },
  };
  const schedules = new ScheduleService(db, {
    now: clock.now,
    transactionHooks,
  });
  const log = recordingLog();
  const maintenance = new CollectionMaintenance({
    db,
    schedules,
    log,
    hooks: { beforePass: options.beforePass },
  });
  const collections = new MediaCollectionRepository(db, { now: clock.now });
  const office = await collections.createAutomatic("The Office", OFFICE);
  const created = await collections.create("Snapshot", ["e1", "e2"]);
  if (created.kind !== "created") throw new Error("snapshot not created");
  return {
    db,
    clock,
    schedules,
    log,
    maintenance,
    collections,
    office: office.id,
    snapshot: created.collection.id,
    failNextPass: (error: Error) => (failure.next = error),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

// Reads a collection's member IDs in position order.
async function memberIds({ collections }: Setup, id: string) {
  return (await collections.listMembers(id))?.map((m) => m.mediaItemId);
}

// Puts the Office collection on the fixture channel and generates its schedule.
async function airOffice(context: Setup) {
  const { db, schedules, office, log } = context;
  await db.insertInto("channels").values(channelFixture).execute();
  await db
    .insertInto("programming_blocks")
    .values({ ...programmingBlockFixture, media_collection_id: office })
    .execute();
  await schedules.ensureCoverage(channelFixture.id, log);
}

// Reads a collection's maintenance diagnostics.
function diagnostics({ db }: Setup, id: string) {
  return db
    .selectFrom("media_collections")
    .select(["maintained_at", "maintenance_error"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

// Reads the fixture channel's schedule revision.
async function revision({ db }: Setup) {
  const state = await db
    .selectFrom("channel_schedule_states")
    .select("schedule_revision")
    .executeTakeFirstOrThrow();
  return state.schedule_revision;
}

describe("CollectionMaintenance", () => {
  it("adds a newly matched episode and drops one that left the series, never touching a manual collection", async () => {
    const context = await setup();
    await seedEpisodes(context.db, [["e3", 1, 3]], { withRoot: false });
    await context.db
      .updateTable("content_facts")
      .set({ series_tmdb_id: 8592 })
      .where("media_item_id", "=", "e1")
      .execute();

    await context.maintenance.request();

    expect(await memberIds(context, context.office)).toEqual(["e2", "e3"]);
    expect(await memberIds(context, context.snapshot)).toEqual(["e1", "e2"]);
  });

  it("reorders after a season correction while the airing episode keeps airing", async () => {
    const context = await setup();
    await airOffice(context);
    const airing = await entryAt(context, FIXTURE_TIME);
    context.clock.advance(60_000);
    await context.db
      .insertInto("metadata_corrections")
      .values(correctionRow("e1", { season_number: 2 }))
      .execute();
    const before = await revision(context);

    await context.maintenance.request();

    expect(await memberIds(context, context.office)).toEqual(["e2", "e1"]);
    expect(airing.media_item_id).toBe("e1");
    expect(await entryAt(context, context.clock.now())).toEqual(airing);
    expect(await revision(context)).toBe(before + 1);
  });

  it("leaves every schedule revision unchanged when nothing changed", async () => {
    const context = await setup();
    await airOffice(context);
    const before = await revision(context);

    await context.maintenance.request();
    await context.maintenance.request();

    expect(await revision(context)).toBe(before);
    expect(await diagnostics(context, context.office)).toEqual({
      maintained_at: FIXTURE_TIME,
      maintenance_error: null,
    });
  });

  it("runs one more pass for a request made while a pass runs, and coalesces the rest", async () => {
    const barrier = createBarrier();
    let passes = 0;
    const context = await setup({
      beforePass: async () => {
        passes += 1;
        if (passes === 1) await barrier.wait();
      },
    });

    const first = context.maintenance.request();
    await barrier.reached;
    await seedEpisodes(context.db, [["e3", 1, 3]], { withRoot: false });
    const second = context.maintenance.request();
    const third = context.maintenance.request();
    barrier.release();
    await Promise.all([first, second, third]);

    expect(passes).toBe(2);
    expect(await memberIds(context, context.office)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
  });

  it("does not recreate a collection deleted while a pass waited to run", async () => {
    const barrier = createBarrier();
    const context = await setup({ beforePass: () => barrier.wait() });

    const pass = context.maintenance.request();
    await barrier.reached;
    await context.collections.delete(context.office);
    barrier.release();
    await pass;

    expect(await context.collections.findById(context.office)).toBeUndefined();
    await expect(
      context.db
        .selectFrom("media_collection_items")
        .select("media_item_id")
        .where("media_collection_id", "=", context.office)
        .execute(),
    ).resolves.toEqual([]);
  });

  it("does not re-add an item removed from the catalog while a pass waited to run", async () => {
    const barrier = createBarrier();
    const context = await setup({ beforePass: () => barrier.wait() });
    const removals = new CatalogRemovalService(context.db, {
      schedules: context.schedules,
      isScanning: () => false,
      collections: new RecordingCollectionMaintenance(),
    });

    const pass = context.maintenance.request();
    await barrier.reached;
    await removals.remove(
      {
        target: { mediaItemIds: ["e1"] },
        airing: "finish",
        allowUnschedulable: false,
      },
      context.log,
    );
    barrier.release();
    await pass;

    expect(await memberIds(context, context.office)).toEqual(["e2"]);
  });

  it("logs and records a failed pass without throwing, and the next pass converges", async () => {
    const context = await setup();
    await seedEpisodes(context.db, [["e3", 1, 3]], { withRoot: false });
    context.failNextPass(new Error("disk I/O error"));

    await expect(context.maintenance.request()).resolves.toBeUndefined();

    expect(await memberIds(context, context.office)).toEqual(["e1", "e2"]);
    expect(await diagnostics(context, context.office)).toEqual({
      maintained_at: FIXTURE_TIME,
      maintenance_error: "disk I/O error",
    });
    expect(context.log.lines).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "Collection maintenance failed",
      }),
    );

    context.clock.advance(1_000);
    await context.maintenance.request();

    expect(await memberIds(context, context.office)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
    expect(await diagnostics(context, context.office)).toEqual({
      maintained_at: FIXTURE_TIME + 1_000,
      maintenance_error: null,
    });
  });

  it("records an unreadable criterion on its own collection and still maintains the others", async () => {
    const context = await setup();
    await context.db
      .insertInto("media_collections")
      .values({
        ...collectionFixture,
        maintenance_mode: "automatic",
        criterion: '{"kind":"actor","name":"Steve Carell"}',
      })
      .execute();
    await seedEpisodes(context.db, [["e3", 1, 3]], { withRoot: false });

    await context.maintenance.request();

    expect(await memberIds(context, context.office)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
    expect(
      (await diagnostics(context, collectionFixture.id)).maintenance_error,
    ).toMatch(/criterion/i);
  });

  it("lets a running pass finish at shutdown, settling waiting requests without another pass", async () => {
    const barrier = createBarrier();
    let passes = 0;
    const context = await setup({
      beforePass: async () => {
        passes += 1;
        await barrier.wait();
      },
    });

    const running = context.maintenance.request();
    await barrier.reached;
    const waiting = context.maintenance.request();
    const stopped = context.maintenance.shutdown();
    let stoppedEarly = false;
    void stopped.then(() => (stoppedEarly = true));
    await flushMicrotasks(10);
    expect(stoppedEarly).toBe(false);
    barrier.release();
    await Promise.all([running, waiting, stopped]);

    expect(passes).toBe(1);
  });

  it("runs no pass once shut down, and a later request settles at once", async () => {
    const context = await setup();
    await seedEpisodes(context.db, [["e3", 1, 3]], { withRoot: false });

    await context.maintenance.shutdown();
    await context.maintenance.request();

    expect(await memberIds(context, context.office)).toEqual(["e1", "e2"]);
  });
});

// Reads the fixture channel's entry airing at `time`.
function entryAt({ db }: Setup, time: number) {
  return db
    .selectFrom("schedule_entries")
    .selectAll()
    .where("channel_id", "=", channelFixture.id)
    .where("starts_at", "<=", time)
    .where("ends_at", ">", time)
    .executeTakeFirstOrThrow();
}
