import {
  EPISODE_FACTS,
  EPISODE_REF as REF,
} from "../../testing/metadata-match-fixtures.js";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { itemFixture, rootFixture } from "../../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { episodeMetadataMigration } from "./011-episode-metadata.js";

afterEach(cleanUpTestEnvironment);

const ITEM_ID = itemFixture.id;

// Opens a migrated database holding one root and one item to attach metadata to.
async function seeded() {
  const { db } = await openTestDatabase();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_items").values(itemFixture).execute();
  return db;
}

describe("011_episode_metadata", () => {
  it("stores an episode's series, season, and episode range with a TV reference", async () => {
    const db = await seeded();

    await db.insertInto("content_facts").values(EPISODE_FACTS).execute();
    await db
      .insertInto("metadata_provider_refs")
      .values({ ...REF, external_kind: "tv", external_id: 1437 })
      .execute();

    await expect(
      db.selectFrom("content_facts").selectAll().execute(),
    ).resolves.toEqual([EPISODE_FACTS]);
    await expect(
      db.selectFrom("metadata_provider_refs").select("external_kind").execute(),
    ).resolves.toEqual([{ external_kind: "tv" }]);
  });

  it.each([
    ["a negative season", { season_number: -1 }],
    ["a fractional episode", { episode_number: 1.5 }],
    ["a text series ID", { series_tmdb_id: "Firefly" }],
  ])("refuses %s", async (_, override) => {
    const db = await seeded();

    await expect(
      db
        .insertInto("content_facts")
        .values({ ...EPISODE_FACTS, ...override } as typeof EPISODE_FACTS)
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("refuses an unknown reference kind", async () => {
    const db = await seeded();

    await expect(
      db
        .insertInto("metadata_provider_refs")
        .values({ ...REF, external_kind: "person" } as unknown as typeof REF)
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("keeps existing references, and their purge cascade, across the reference table rebuild", async () => {
    const db = await seeded();
    await db.insertInto("metadata_provider_refs").values(REF).execute();

    await episodeMetadataMigration.down?.(db as Kysely<unknown>);
    await episodeMetadataMigration.up(db as Kysely<unknown>);

    await expect(
      db.selectFrom("metadata_provider_refs").selectAll().execute(),
    ).resolves.toEqual([REF]);
    await db.deleteFrom("media_items").where("id", "=", ITEM_ID).execute();
    await expect(
      db.selectFrom("metadata_provider_refs").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});
