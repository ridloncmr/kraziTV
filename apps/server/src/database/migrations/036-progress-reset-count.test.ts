import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { collectionFixture } from "../../testing/catalog-fixtures.js";
import {
  channelFixture,
  collectionProgressFixture,
} from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { progressResetCountMigration } from "./036-progress-reset-count.js";

afterEach(cleanUpTestEnvironment);

// A database holding the fixture channel and collection, so a progress row
// satisfies its foreign keys.
async function seeded() {
  const { db } = await openTestDatabase();
  await db.insertInto("channels").values(channelFixture).execute();
  await db.insertInto("media_collections").values(collectionFixture).execute();
  return db;
}

// Random progress stored before reset counts: every column but the count.
const { reset_count: _, ...LEGACY_PROGRESS } = {
  ...collectionProgressFixture,
  playback_mode: "random",
  last_media_item_id: null,
  last_position: null,
  next_selection_index: 12,
  reset_sequence_number: 4,
} as const;

describe("036_progress_reset_count", () => {
  it("starts progress stored before it at a count of 0, so its order is kept", async () => {
    const db = await seeded();
    const legacy = db as Kysely<unknown>;
    await progressResetCountMigration.down?.(legacy);
    await db
      .insertInto("channel_collection_progress")
      .values(LEGACY_PROGRESS)
      .execute();

    await progressResetCountMigration.up(legacy);

    await expect(
      db.selectFrom("channel_collection_progress").selectAll().execute(),
    ).resolves.toEqual([{ ...LEGACY_PROGRESS, reset_count: 0 }]);
  });

  it("stores a count and refuses a negative or fractional one", async () => {
    const db = await seeded();

    await db
      .insertInto("channel_collection_progress")
      .values({ ...LEGACY_PROGRESS, reset_count: 3 })
      .execute();
    await expect(
      db
        .selectFrom("channel_collection_progress")
        .select("reset_count")
        .execute(),
    ).resolves.toEqual([{ reset_count: 3 }]);

    await db.deleteFrom("channel_collection_progress").execute();
    for (const resetCount of [-1, 1.5]) {
      await expect(
        db
          .insertInto("channel_collection_progress")
          .values({ ...LEGACY_PROGRESS, reset_count: resetCount })
          .execute(),
      ).rejects.toThrow(/CHECK constraint/);
    }
  });

  it("drops the count on down and keeps the progress", async () => {
    const db = await seeded();
    await db
      .insertInto("channel_collection_progress")
      .values({ ...LEGACY_PROGRESS, reset_count: 2 })
      .execute();

    await progressResetCountMigration.down?.(db as Kysely<unknown>);

    await expect(
      db.selectFrom("channel_collection_progress").selectAll().execute(),
    ).resolves.toEqual([LEGACY_PROGRESS]);
  });
});
