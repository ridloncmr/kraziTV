import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../schema/database-schema.js";
import {
  collectionFixture,
  itemFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  channelFixture,
  programmingBlockFixture,
  scheduleEntryFixture,
} from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { orderedPlaybackModesMigration } from "./019-ordered-playback-modes.js";

afterEach(cleanUpTestEnvironment);

// Seeds a channel whose collection block has produced one entry.
async function seeded() {
  const { db } = await openTestDatabase();
  await db.insertInto("channels").values(channelFixture).execute();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_items").values(itemFixture).execute();
  await db.insertInto("media_collections").values(collectionFixture).execute();
  return db;
}

// Reads the schema objects of both rebuilt tables, so a rebuild can be
// checked for a dropped or altered index.
async function indexSql(db: Kysely<DatabaseSchema>) {
  const { rows } = await sql<{ name: string; sql: string }>`
    select name, sql from sqlite_master
    where type = 'index' and sql is not null
      and tbl_name in ('programming_blocks', 'schedule_entries')
    order by name`.execute(db);
  return rows;
}

// Reads whether the connection enforces foreign keys.
async function foreignKeysOn(db: Kysely<DatabaseSchema>) {
  const { rows } = await sql<{
    foreign_keys: number;
  }>`pragma foreign_keys`.execute(db);
  return rows[0]?.foreign_keys === 1;
}

describe("019_ordered_playback_modes", () => {
  it.each(["episode", "release"] as const)(
    "stores a block and an entry in %s mode",
    async (playbackMode) => {
      const db = await seeded();

      await db
        .insertInto("programming_blocks")
        .values({ ...programmingBlockFixture, playback_mode: playbackMode })
        .execute();
      await db
        .insertInto("schedule_entries")
        .values({ ...scheduleEntryFixture, playback_mode: playbackMode })
        .execute();

      await expect(
        db.selectFrom("programming_blocks").select("playback_mode").execute(),
      ).resolves.toEqual([{ playback_mode: playbackMode }]);
      await expect(
        db.selectFrom("schedule_entries").select("playback_mode").execute(),
      ).resolves.toEqual([{ playback_mode: playbackMode }]);
    },
  );

  it("still refuses an unknown mode on blocks and entries", async () => {
    const db = await seeded();
    await db
      .insertInto("programming_blocks")
      .values(programmingBlockFixture)
      .execute();

    await expect(
      db
        .updateTable("programming_blocks")
        // Typed as a mode, since the value deliberately is not one.
        .set({ playback_mode: "shuffle" as "random" })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
    await expect(
      db
        .insertInto("schedule_entries")
        .values({
          ...scheduleEntryFixture,
          playback_mode: "shuffle" as "random",
        })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("keeps every entry's block, every index, and enforcement across the rebuild", async () => {
    const db = await seeded();
    const indexesBefore = await indexSql(db);
    const legacy = db as Kysely<unknown>;
    await orderedPlaybackModesMigration.down?.(legacy);
    await db
      .insertInto("programming_blocks")
      .values(programmingBlockFixture)
      .execute();
    await db
      .insertInto("schedule_entries")
      .values(scheduleEntryFixture)
      .execute();

    await orderedPlaybackModesMigration.up(legacy);

    await expect(
      db.selectFrom("schedule_entries").selectAll().execute(),
    ).resolves.toEqual([scheduleEntryFixture]);
    await expect(
      db.selectFrom("programming_blocks").selectAll().execute(),
    ).resolves.toEqual([programmingBlockFixture]);
    await expect(indexSql(db)).resolves.toEqual(indexesBefore);
    await expect(foreignKeysOn(db)).resolves.toBe(true);
  });

  it("refuses to narrow the modes while a block uses a new one, and re-enables enforcement", async () => {
    const db = await seeded();
    await db
      .insertInto("programming_blocks")
      .values({ ...programmingBlockFixture, playback_mode: "episode" })
      .execute();

    await expect(
      orderedPlaybackModesMigration.down?.(db as Kysely<unknown>),
    ).rejects.toThrow(/CHECK constraint/);

    await expect(foreignKeysOn(db)).resolves.toBe(true);
    await expect(
      db.selectFrom("programming_blocks").select("playback_mode").execute(),
    ).resolves.toEqual([{ playback_mode: "episode" }]);
  });
});
