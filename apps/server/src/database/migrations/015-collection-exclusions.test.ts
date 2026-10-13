import { afterEach, describe, expect, it } from "vitest";

import {
  collectionFixture,
  FIXTURE_TIME,
  itemFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const EXCLUSION = {
  media_collection_id: collectionFixture.id,
  media_item_id: itemFixture.id,
  created_at: FIXTURE_TIME,
};

// Opens a database holding one collection and one item to exclude from it.
async function seeded() {
  const { db } = await openTestDatabase();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_items").values(itemFixture).execute();
  await db
    .insertInto("media_collections")
    .values({
      ...collectionFixture,
      maintenance_mode: "automatic",
      criterion: '{"kind":"series","tmdbId":2316}',
    })
    .execute();
  return db;
}

describe("015_collection_exclusions", () => {
  it("stores one exclusion per collection and item", async () => {
    const db = await seeded();

    await db
      .insertInto("media_collection_exclusions")
      .values(EXCLUSION)
      .execute();

    await expect(
      db.selectFrom("media_collection_exclusions").selectAll().execute(),
    ).resolves.toEqual([EXCLUSION]);
    await expect(
      db.insertInto("media_collection_exclusions").values(EXCLUSION).execute(),
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it.each([
    ["its collection is deleted", "media_collections"],
    ["its item is purged", "media_items"],
  ] as const)("drops an exclusion when %s", async (_, table) => {
    const db = await seeded();
    await db
      .insertInto("media_collection_exclusions")
      .values(EXCLUSION)
      .execute();

    await db.deleteFrom(table).execute();

    await expect(
      db.selectFrom("media_collection_exclusions").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("refuses a creation time that is not a safe integer", async () => {
    const db = await seeded();

    await expect(
      db
        .insertInto("media_collection_exclusions")
        .values({ ...EXCLUSION, created_at: 1.5 })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
