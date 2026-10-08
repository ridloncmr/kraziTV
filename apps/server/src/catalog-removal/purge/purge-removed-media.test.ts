import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import { FIXTURE_TIME, rootFixture } from "../../testing/catalog-fixtures.js";
import {
  channelFixture,
  scheduleStateFixture,
} from "../../testing/channel-fixtures.js";
import {
  insertScheduleEntries,
  seedScheduleScenario,
} from "../../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { purgeRemovedMedia } from "./purge-removed-media.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
const NOW = T0 + 60 * MINUTE;
const OTHER_CHANNEL = "channel-other";

// Seeds four items on two channels' schedules:
// item-001 removed, every entry ended         -> purged with its entries
// item-002 removed, one entry still airing    -> waits, entries kept
// item-003 kept, its entries ended            -> untouched
// item-004 removed, never scheduled           -> purged
async function setup() {
  const { db } = await openTestDatabase();
  const { channelId } = await seedScheduleScenario(db, {
    items: [1, 2, 3, 4].map(() => ({ durationMs: 10 * MINUTE })),
    source: "chronological",
  });
  await db
    .insertInto("channels")
    .values({ ...channelFixture, id: OTHER_CHANNEL, number: "70" })
    .execute();
  await db
    .insertInto("channel_schedule_states")
    .values([
      { ...scheduleStateFixture, schedule_revision: 3 },
      {
        ...scheduleStateFixture,
        channel_id: OTHER_CHANNEL,
        schedule_revision: 7,
      },
    ])
    .execute();
  await insertScheduleEntries(db, [
    {
      mediaItemId: "item-001",
      startsAt: T0,
      endsAt: T0 + 10 * MINUTE,
      sequenceNumber: 0,
    },
    {
      mediaItemId: "item-002",
      startsAt: T0 + 10 * MINUTE,
      endsAt: T0 + 20 * MINUTE,
      sequenceNumber: 1,
    },
    {
      mediaItemId: "item-001",
      startsAt: T0 + 20 * MINUTE,
      endsAt: NOW,
      sequenceNumber: 2,
    },
    {
      mediaItemId: "item-003",
      startsAt: T0,
      endsAt: T0 + 10 * MINUTE,
      sequenceNumber: 0,
      channelId: OTHER_CHANNEL,
    },
    {
      mediaItemId: "item-002",
      startsAt: NOW - MINUTE,
      endsAt: NOW + MINUTE,
      sequenceNumber: 1,
      channelId: OTHER_CHANNEL,
    },
  ]);
  await db
    .deleteFrom("media_collection_items")
    .where("media_item_id", "in", ["item-001", "item-002", "item-004"])
    .execute();
  await db
    .updateTable("media_items")
    .set({ removed_at: T0 })
    .where("id", "in", ["item-001", "item-002", "item-004"])
    .execute();
  return { db, channelId };
}

// Reads each channel's revision, keyed by channel ID.
async function revisions(db: Kysely<DatabaseSchema>) {
  const rows = await db
    .selectFrom("channel_schedule_states")
    .select(["channel_id", "schedule_revision", "updated_at"])
    .orderBy("channel_id")
    .execute();
  return rows;
}

describe("purgeRemovedMedia", () => {
  it("deletes removed items no entry holds past now, with their ended entries", async () => {
    const { db, channelId } = await setup();

    await runImmediateTransaction(db, (trx) => purgeRemovedMedia(trx, NOW));

    await expect(
      db.selectFrom("media_items").select("id").orderBy("id").execute(),
    ).resolves.toEqual([{ id: "item-002" }, { id: "item-003" }]);
    await expect(
      db.selectFrom("schedule_entries").select("id").orderBy("id").execute(),
    ).resolves.toEqual([
      { id: "channel-other-entry-0" },
      { id: "channel-other-entry-1" },
      { id: "entry-1" },
    ]);
    // Only the channel that lost entries advances, once.
    await expect(revisions(db)).resolves.toEqual([
      { channel_id: channelId, schedule_revision: 4, updated_at: NOW },
      {
        channel_id: OTHER_CHANNEL,
        schedule_revision: 7,
        updated_at: scheduleStateFixture.updated_at,
      },
    ]);
  });

  it("leaves a revision the same commit already advanced", async () => {
    const { db, channelId } = await setup();

    await runImmediateTransaction(db, (trx) =>
      purgeRemovedMedia(trx, NOW, new Set([channelId])),
    );

    await expect(
      db
        .selectFrom("schedule_entries")
        .select("id")
        .where("id", "=", "entry-0")
        .execute(),
    ).resolves.toEqual([]);
    await expect(revisions(db)).resolves.toMatchObject([
      { channel_id: channelId, schedule_revision: 3 },
      { channel_id: OTHER_CHANNEL, schedule_revision: 7 },
    ]);
  });

  it("changes nothing when nothing is purgeable", async () => {
    const { db } = await setup();
    await runImmediateTransaction(db, (trx) => purgeRemovedMedia(trx, NOW));
    const before = await revisions(db);

    await runImmediateTransaction(db, (trx) => purgeRemovedMedia(trx, NOW));

    await expect(revisions(db)).resolves.toEqual(before);
  });
});

describe("purgeRemovedMedia for removed roots", () => {
  it("deletes a removed root once it has no items, and keeps one that still has some", async () => {
    const { db } = await setup();
    await db
      .insertInto("media_roots")
      .values([
        {
          ...rootFixture,
          id: "root-empty",
          path: "/a",
          path_key: "/a",
          removed_at: T0,
        },
        { ...rootFixture, id: "root-cataloged", path: "/b", path_key: "/b" },
      ])
      .execute();
    // The fixture root holds item-002, which an airing entry keeps.
    await db
      .updateTable("media_roots")
      .set({ removed_at: T0 })
      .where("id", "=", rootFixture.id)
      .execute();

    await runImmediateTransaction(db, (trx) => purgeRemovedMedia(trx, NOW));

    await expect(
      db.selectFrom("media_roots").select("id").orderBy("id").execute(),
    ).resolves.toEqual([{ id: "root-cataloged" }, { id: rootFixture.id }]);
  });
});
