import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { itemFixtureAt } from "../../testing/catalog-fixtures.js";
import { seededMetadataDatabase as seeded } from "../../testing/metadata-match-fixtures.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";
import { tagsMigration } from "./016-tags.js";

afterEach(cleanUpTestEnvironment);

// Reads each item's tag names in the owner's order, keyed by item.
async function tagsByItem(db: Kysely<unknown>) {
  const { rows } = await sql<{ item: string; names: string }>`
    select it.media_item_id as item, json_group_array(t.name order by it.position) as names
    from media_item_tags it join tags t on t.id = it.tag_id
    group by it.media_item_id order by it.media_item_id`.execute(db);
  return Object.fromEntries(
    rows.map((row) => [row.item, JSON.parse(row.names) as string[]]),
  );
}

describe("016_tags", () => {
  it("moves each item's tags into tag identities, case-insensitively, keeping their order", async () => {
    const db = await seeded();
    await db
      .insertInto("media_items")
      .values(itemFixtureAt("item-2", "/media/movies/second.mkv"))
      .execute();
    const legacy = db as Kysely<unknown>;
    await tagsMigration.down?.(legacy);
    await sql`insert into metadata_corrections (media_item_id, title, series_name, season_number, episode_number, tags) values
      ('item-fixture-001', 'Serenity', null, null, null, '["Space Western","Christmas"]'),
      ('item-2', null, null, null, null, '["christmas","christmas "]')`.execute(
      legacy,
    );

    await tagsMigration.up(legacy);

    await expect(tagsByItem(legacy)).resolves.toEqual({
      "item-2": ["Christmas"],
      "item-fixture-001": ["Space Western", "Christmas"],
    });
    await expect(
      db.selectFrom("metadata_corrections").selectAll().execute(),
    ).resolves.toEqual([
      {
        media_item_id: "item-fixture-001",
        title: "Serenity",
        series_name: null,
        season_number: null,
        episode_number: null,
      },
    ]);
  });

  it("drops an item's tags when the item is purged, and refuses a second tag of the same name", async () => {
    const db = await seeded();
    await db
      .insertInto("tags")
      .values({ id: "tag-1", name: "Christmas", name_key: "christmas" })
      .execute();
    await db
      .insertInto("media_item_tags")
      .values({
        media_item_id: "item-fixture-001",
        tag_id: "tag-1",
        position: 0,
      })
      .execute();

    await expect(
      db
        .insertInto("tags")
        .values({ id: "tag-2", name: "CHRISTMAS", name_key: "christmas" })
        .execute(),
    ).rejects.toThrow(/UNIQUE/);
    await db.deleteFrom("media_items").execute();
    await expect(
      db.selectFrom("media_item_tags").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});
