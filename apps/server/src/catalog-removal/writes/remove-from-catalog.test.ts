import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import {
  collectionFixture,
  FIXTURE_TIME,
  insertTitledItems,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { removeFromCatalog } from "./remove-from-catalog.js";

afterEach(cleanUpTestEnvironment);

const LATER = FIXTURE_TIME + 5_000;

// Seeds items a-e and three collections. Membership order differs from item
// IDs, so a compaction that sorts by ID instead of position fails.
async function setup() {
  const { db } = await openTestDatabase();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await insertTitledItems(db, ["a", "b", "c", "d", "e"]);
  const collections = {
    mixed: ["e", "b", "d", "a", "c"],
    only: ["a"],
    other: ["c", "e"],
  };
  for (const [id, members] of Object.entries(collections)) {
    await db
      .insertInto("media_collections")
      .values({ ...collectionFixture, id, name: id })
      .execute();
    await db
      .insertInto("media_collection_items")
      .values(
        members.map((mediaItemId, position) => ({
          media_collection_id: id,
          media_item_id: mediaItemId,
          position,
          created_at: FIXTURE_TIME,
        })),
      )
      .execute();
  }
  return db;
}

// Reads one collection's members in position order with their positions.
async function members(db: Kysely<DatabaseSchema>, id: string) {
  const rows = await db
    .selectFrom("media_collection_items")
    .select(["media_item_id", "position"])
    .where("media_collection_id", "=", id)
    .orderBy("position")
    .execute();
  return rows.map((row) => `${row.position}:${row.media_item_id}`);
}

describe("removeFromCatalog", () => {
  it("marks items removed and compacts each affected collection in its previous order", async () => {
    const db = await setup();

    await runImmediateTransaction(db, (trx) =>
      removeFromCatalog(trx, { mediaItemIds: ["b", "a"] }, LATER),
    );

    await expect(members(db, "mixed")).resolves.toEqual(["0:e", "1:d", "2:c"]);
    await expect(members(db, "only")).resolves.toEqual([]);
    await expect(members(db, "other")).resolves.toEqual(["0:c", "1:e"]);
    await expect(
      db
        .selectFrom("media_items")
        .select(["id", "removed_at"])
        .orderBy("id")
        .execute(),
    ).resolves.toEqual([
      { id: "a", removed_at: LATER },
      { id: "b", removed_at: LATER },
      { id: "c", removed_at: null },
      { id: "d", removed_at: null },
      { id: "e", removed_at: null },
    ]);
    // Only collections that lost members record the change.
    await expect(
      db
        .selectFrom("media_collections")
        .select(["id", "updated_at"])
        .orderBy("id")
        .execute(),
    ).resolves.toEqual([
      { id: "mixed", updated_at: LATER },
      { id: "only", updated_at: LATER },
      { id: "other", updated_at: FIXTURE_TIME },
    ]);
  });
});
