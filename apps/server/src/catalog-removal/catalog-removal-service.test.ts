import { afterEach, describe, expect, it } from "vitest";

import {
  collectionFixture,
  FIXTURE_TIME,
  insertTitledItems,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import { countQueries } from "../testing/query-counter.js";
import { sequentialIds } from "../testing/record-sources.js";
import { recordingLog } from "../testing/recording-log.js";
import { seedScheduleScenario } from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";
import { insertMembers } from "../media-collections/media-collection-repository.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { CatalogRemovalService } from "./catalog-removal-service.js";

afterEach(cleanUpTestEnvironment);

// Seeds a channel whose block plays item-001 directly, and a service whose
// scanner reports the fixture root as scanning.
async function setup() {
  const { db } = await openTestDatabase();
  await seedScheduleScenario(db, {
    items: [{ durationMs: 60_000 }, { durationMs: 60_000 }],
    source: "media_item",
  });
  const schedules = new ScheduleService(db, {
    now: manualClock(FIXTURE_TIME).now,
    createId: sequentialIds("entry"),
  });
  const removals = new CatalogRemovalService(db, {
    schedules,
    isScanning: (rootId) => rootId === rootFixture.id,
  });
  return { db, removals };
}

describe("CatalogRemovalService refusals", () => {
  it("refuses unknown items before a scan of their root", async () => {
    const { removals } = await setup();

    await expect(
      removals.remove(
        {
          target: { mediaItemIds: ["item-001", "unknown"] },
          airing: "finish",
          allowUnschedulable: false,
        },
        recordingLog(),
      ),
    ).resolves.toEqual({
      kind: "unknown_media_items",
      mediaItemIds: ["unknown"],
    });
  });

  it("refuses a scan of an item's root before a block that plays the item", async () => {
    const { db, removals } = await setup();

    await expect(
      removals.remove(
        {
          target: { mediaItemIds: ["item-001"] },
          airing: "finish",
          allowUnschedulable: false,
        },
        recordingLog(),
      ),
    ).resolves.toEqual({ kind: "scan_in_progress" });
    await expect(
      db.selectFrom("media_items").select("removed_at").execute(),
    ).resolves.toEqual([{ removed_at: null }, { removed_at: null }]);
  });
});

describe("CatalogRemovalService root removal", () => {
  // Seeds one root of `count` items, all members of one collection, and
  // counts the statements removing the root runs.
  async function countRootRemoval(count: number) {
    const { db } = await openTestDatabase();
    await db.insertInto("media_roots").values(rootFixture).execute();
    const ids = Array.from({ length: count }, (_, index) => `item-${index}`);
    await insertTitledItems(db, ids);
    await db
      .insertInto("media_collections")
      .values(collectionFixture)
      .execute();
    // One transaction, so the large seed pays for one commit.
    await db
      .transaction()
      .execute((trx) =>
        insertMembers(trx, collectionFixture.id, ids, FIXTURE_TIME),
      );
    const counted = countQueries(db);
    const removals = new CatalogRemovalService(counted.db, {
      schedules: new ScheduleService(counted.db, {
        now: manualClock(FIXTURE_TIME).now,
      }),
      isScanning: () => false,
    });

    const outcome = await removals.remove(
      {
        target: { mediaRootId: rootFixture.id },
        airing: "finish",
        allowUnschedulable: false,
      },
      recordingLog(),
    );

    expect(outcome).toMatchObject({
      kind: "removed",
      removal: { removedItemCount: count },
    });
    await expect(
      db
        .selectFrom("media_items")
        .select((eb) => eb.fn.countAll().as("n"))
        .executeTakeFirst(),
    ).resolves.toEqual({ n: 0 });
    return counted.count();
  }

  it("runs the same number of statements for 10,000 items as for 10", async () => {
    const small = await countRootRemoval(10);
    const large = await countRootRemoval(10_000);

    expect(large).toBe(small);
  });
});
