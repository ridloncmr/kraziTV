import type { Insertable } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { KraziDatabase } from "../database.js";
import type { ChannelCollectionProgressTable } from "../schema/channel-collection-progress-table.js";
import type { ChannelScheduleStateTable } from "../schema/channel-schedule-state-table.js";
import type { ScheduleEntryTable } from "../schema/schedule-entry-table.js";
import {
  collectionFixture,
  itemFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  channelFixture,
  collectionProgressFixture,
  programmingBlockFixture,
  scheduleEntryFixture,
  scheduleStateFixture,
} from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

describe("005_schedules", () => {
  it("accepts well-formed state, entry, and progress rows", async () => {
    const database = await seedScheduleInputs();

    await insertScheduleRows(database);

    await expect(
      database.db.selectFrom("channel_schedule_states").selectAll().execute(),
    ).resolves.toEqual([scheduleStateFixture]);
    await expect(
      database.db.selectFrom("schedule_entries").selectAll().execute(),
    ).resolves.toEqual([scheduleEntryFixture]);
    await expect(
      database.db
        .selectFrom("channel_collection_progress")
        .selectAll()
        .execute(),
    ).resolves.toEqual([collectionProgressFixture]);
  });

  it("rejects malformed schedule state", async () => {
    const database = await seedScheduleInputs();
    const invalid: Insertable<ChannelScheduleStateTable>[] = [
      { ...scheduleStateFixture, seed: -1 },
      { ...scheduleStateFixture, seed: 4_294_967_296 },
      {
        ...scheduleStateFixture,
        last_generated_through: scheduleStateFixture.anchor_time - 1,
      },
      { ...scheduleStateFixture, next_sequence_number: -1 },
      { ...scheduleStateFixture, schedule_revision: 0 },
      { ...scheduleStateFixture, anchor_time: 1.5 },
      { ...scheduleStateFixture, updated_at: -1 },
    ];

    for (const state of invalid) {
      await expect(
        database.db
          .insertInto("channel_schedule_states")
          .values(state)
          .execute(),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it("rejects malformed schedule entries", async () => {
    const database = await seedScheduleInputs();
    const invalid: Insertable<ScheduleEntryTable>[] = [
      { ...scheduleEntryFixture, title: " " },
      { ...scheduleEntryFixture, ends_at: scheduleEntryFixture.ends_at + 1 },
      { ...scheduleEntryFixture, duration_ms: 0, ends_at: 0, starts_at: 0 },
      { ...scheduleEntryFixture, sequence_number: -1 },
      { ...scheduleEntryFixture, playback_mode: "shuffle" as "random" },
      { ...scheduleEntryFixture, playback_mode: null },
      { ...scheduleEntryFixture, playback_index: null },
      { ...scheduleEntryFixture, playback_index: -1 },
      { ...scheduleEntryFixture, starts_at: 0.5, ends_at: 3_600_000.5 },
    ];

    for (const entry of invalid) {
      await expect(
        database.db.insertInto("schedule_entries").values(entry).execute(),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it("rejects negative collection progress", async () => {
    const database = await seedScheduleInputs();
    const invalid: Insertable<ChannelCollectionProgressTable>[] = [
      { ...collectionProgressFixture, next_chronological_position: -1 },
      { ...collectionProgressFixture, next_random_selection_index: -1 },
    ];

    for (const progress of invalid) {
      await expect(
        database.db
          .insertInto("channel_collection_progress")
          .values(progress)
          .execute(),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it("keeps sequence numbers unique per channel", async () => {
    const database = await seedScheduleInputs();
    await insertScheduleRows(database);

    await expect(
      database.db
        .insertInto("schedule_entries")
        .values({ ...scheduleEntryFixture, id: "entry-second" })
        .execute(),
    ).rejects.toThrow(
      /unique constraint failed: schedule_entries\.channel_id, schedule_entries\.sequence_number/i,
    );
  });

  it("deletes a channel's state, entries, and progress with the channel", async () => {
    const database = await seedScheduleInputs();
    await insertScheduleRows(database);

    await database.db
      .deleteFrom("channels")
      .where("id", "=", channelFixture.id)
      .execute();

    for (const table of [
      "channel_schedule_states",
      "schedule_entries",
      "channel_collection_progress",
    ] as const) {
      await expect(
        database.db.selectFrom(table).selectAll().execute(),
      ).resolves.toEqual([]);
    }
  });

  it("keeps entries as history when their block or collection is deleted", async () => {
    const database = await seedScheduleInputs();
    await insertScheduleRows(database);

    await database.db.deleteFrom("programming_blocks").execute();
    await database.db.deleteFrom("media_collections").execute();

    await expect(
      database.db.selectFrom("schedule_entries").selectAll().execute(),
    ).resolves.toEqual([
      {
        ...scheduleEntryFixture,
        programming_block_id: null,
        media_collection_id: null,
      },
    ]);
    await expect(
      database.db
        .selectFrom("channel_collection_progress")
        .selectAll()
        .execute(),
    ).resolves.toEqual([]);
  });
});

/** Opens a database holding the channel, catalog, and block that schedule rows reference. */
async function seedScheduleInputs(): Promise<KraziDatabase> {
  const database = await openTestDatabase();
  await database.db.insertInto("channels").values(channelFixture).execute();
  await database.db.insertInto("media_roots").values(rootFixture).execute();
  await database.db.insertInto("media_items").values(itemFixture).execute();
  await database.db
    .insertInto("media_collections")
    .values(collectionFixture)
    .execute();
  await database.db
    .insertInto("programming_blocks")
    .values(programmingBlockFixture)
    .execute();
  return database;
}

/** Inserts the fixture channel's state, first entry, and collection progress. */
async function insertScheduleRows(database: KraziDatabase): Promise<void> {
  await database.db
    .insertInto("channel_schedule_states")
    .values(scheduleStateFixture)
    .execute();
  await database.db
    .insertInto("schedule_entries")
    .values(scheduleEntryFixture)
    .execute();
  await database.db
    .insertInto("channel_collection_progress")
    .values(collectionProgressFixture)
    .execute();
}
