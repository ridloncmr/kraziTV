import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import {
  FIXTURE_TIME,
  itemFixtureAt,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

describe("007_catalog_removal", () => {
  it("stores removal times on roots and items, null until removed", async () => {
    const database = await openTestDatabase();
    await database.db
      .insertInto("media_roots")
      .values([
        rootFixture,
        {
          ...rootFixture,
          id: "root-removed",
          path: "/media/removed",
          path_key: "/media/removed",
          removed_at: FIXTURE_TIME,
        },
      ])
      .execute();
    await database.db
      .insertInto("media_items")
      .values([
        itemFixtureAt("item-kept", "/media/movies/kept.mkv"),
        itemFixtureAt("item-removed", "/media/movies/removed.mkv", {
          removed_at: FIXTURE_TIME,
        }),
      ])
      .execute();

    await expect(
      database.db
        .selectFrom("media_roots")
        .select("removed_at")
        .orderBy("id")
        .execute(),
    ).resolves.toEqual([{ removed_at: null }, { removed_at: FIXTURE_TIME }]);
    await expect(
      database.db
        .selectFrom("media_items")
        .select("removed_at")
        .orderBy("id")
        .execute(),
    ).resolves.toEqual([{ removed_at: null }, { removed_at: FIXTURE_TIME }]);
  });

  it.each([
    ["a root", "media_roots"],
    ["an item", "media_items"],
  ] as const)(
    "rejects a removal time on %s that is not a safe integer",
    async (_, table) => {
      const database = await openTestDatabase();
      await database.db.insertInto("media_roots").values(rootFixture).execute();
      await database.db
        .insertInto("media_items")
        .values(itemFixtureAt("item-1", "/media/movies/1.mkv"))
        .execute();

      for (const invalid of [-1, 1.5, "soon"]) {
        await expect(
          sql`update ${sql.table(table)} set removed_at = ${invalid}`.execute(
            database.db,
          ),
        ).rejects.toThrow(/constraint/i);
      }
    },
  );

  it("indexes item removal times for purge", async () => {
    const database = await openTestDatabase();

    const indexes = await sql<{ name: string }>`
      select name from pragma_index_list('media_items')
    `.execute(database.db);

    expect(indexes.rows.map((row) => row.name)).toContain(
      "media_items_removed_at",
    );
  });
});
