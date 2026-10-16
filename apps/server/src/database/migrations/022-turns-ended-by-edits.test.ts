import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectionFixture,
  itemFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  channelFixture,
  programmingBlockFixture,
} from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { turnsEndedByEditsMigration } from "./022-turns-ended-by-edits.js";

afterEach(cleanUpTestEnvironment);

// Seeds what a block row references.
async function seeded() {
  const { db } = await openTestDatabase();
  await db.insertInto("channels").values(channelFixture).execute();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_items").values(itemFixture).execute();
  await db.insertInto("media_collections").values(collectionFixture).execute();
  return db;
}

describe("022_turns_ended_by_edits", () => {
  it("reads an existing block back as not ended", async () => {
    const db = await seeded();
    const legacy = db as Kysely<unknown>;
    await turnsEndedByEditsMigration.down?.(legacy);
    const { ended_by_edit: _, ...legacyBlock } = programmingBlockFixture;
    // Typed as a current row, since the legacy table has no flag column yet.
    await db
      .insertInto("programming_blocks")
      .values(legacyBlock as typeof programmingBlockFixture)
      .execute();

    await turnsEndedByEditsMigration.up(legacy);

    await expect(
      db.selectFrom("programming_blocks").select("ended_by_edit").execute(),
    ).resolves.toEqual([{ ended_by_edit: 0 }]);
  });

  it("refuses a flag other than 0 or 1", async () => {
    const db = await seeded();

    await expect(
      db
        .insertInto("programming_blocks")
        .values({ ...programmingBlockFixture, ended_by_edit: 2 })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
