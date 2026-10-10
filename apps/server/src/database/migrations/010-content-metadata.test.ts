import { seededMetadataDatabase as seeded } from "../../testing/metadata-match-fixtures.js";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME, itemFixture } from "../../testing/catalog-fixtures.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const ITEM_ID = itemFixture.id;

const MATCH = {
  media_item_id: ITEM_ID,
  state: "matched",
  extra: 0,
  lookup_error: null,
  looked_up_at: FIXTURE_TIME,
  evidence: '{"title":"Alien","year":1979}',
  matched_duration_ms: 6_000_000,
} as const;

describe("010_content_metadata", () => {
  it("stores a match with its facts, TMDB reference, and candidates", async () => {
    const db = await seeded();

    await db.insertInto("metadata_matches").values(MATCH).execute();
    await db
      .insertInto("content_facts")
      .values({
        media_item_id: ITEM_ID,
        content_type: "movie",
        title: "Alien",
        release_date: "1979-05-25",
        genres: '["Horror"]',
        franchise_tmdb_id: 8091,
        franchise_name: "Alien Collection",
        description: "In space…",
        poster_path: "/alien.jpg",
      })
      .execute();
    await db
      .insertInto("metadata_provider_refs")
      .values({
        media_item_id: ITEM_ID,
        provider: "tmdb",
        external_kind: "movie",
        external_id: 348,
        fetched_at: FIXTURE_TIME,
      })
      .execute();
    await db
      .insertInto("metadata_match_candidates")
      .values({
        media_item_id: ITEM_ID,
        position: 0,
        tmdb_id: 348,
        title: "Alien",
        release_date: "1979",
        poster_path: null,
      })
      .execute();

    await expect(
      db.selectFrom("metadata_matches").selectAll().execute(),
    ).resolves.toEqual([MATCH]);
  });

  it("purging an item takes its metadata with it", async () => {
    const db = await seeded();
    await db.insertInto("metadata_matches").values(MATCH).execute();
    await db
      .insertInto("metadata_match_candidates")
      .values({
        media_item_id: ITEM_ID,
        position: 0,
        tmdb_id: 1,
        title: "A",
        release_date: null,
        poster_path: null,
      })
      .execute();

    await db.deleteFrom("media_items").where("id", "=", ITEM_ID).execute();

    await expect(
      db.selectFrom("metadata_matches").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      db.selectFrom("metadata_match_candidates").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it.each([
    ["an unknown state", { state: "maybe" }],
    ["a lookup error on a match", { lookup_error: "TMDB answered HTTP 503" }],
    ["an extra that is matched", { extra: 1 }],
    ["a non-boolean extra flag", { extra: 2, state: "unmatched" }],
  ])("refuses %s", async (_, override) => {
    const db = await seeded();

    await expect(
      db
        .insertInto("metadata_matches")
        .values({ ...MATCH, ...override } as typeof MATCH)
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("refuses an unknown content type and a malformed release date", async () => {
    const db = await seeded();
    const facts = {
      media_item_id: ITEM_ID,
      content_type: "movie",
      title: "Alien",
      release_date: null,
      genres: "[]",
      franchise_tmdb_id: null,
      franchise_name: null,
      description: null,
      poster_path: null,
    } as const;

    await expect(
      db
        .insertInto("content_facts")
        .values({ ...facts, content_type: "film" } as unknown as typeof facts)
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
    await expect(
      db
        .insertInto("content_facts")
        .values({ ...facts, release_date: "25/05/1979" })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
