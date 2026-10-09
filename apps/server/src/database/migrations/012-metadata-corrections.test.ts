import { afterEach, describe, expect, it } from "vitest";

import {
  CORRECTION,
  seededMetadataDatabase as seeded,
} from "../../testing/metadata-match-fixtures.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

describe("012_metadata_corrections", () => {
  it("stores one item's corrections and tags, and drops them when the item is purged", async () => {
    const db = await seeded();

    await db.insertInto("metadata_corrections").values(CORRECTION).execute();
    await expect(
      db.selectFrom("metadata_corrections").selectAll().execute(),
    ).resolves.toEqual([CORRECTION]);

    await db.deleteFrom("media_items").execute();
    await expect(
      db.selectFrom("metadata_corrections").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it.each([
    ["a blank title", { title: "  " }],
    ["a blank series", { series_name: "" }],
    ["a negative season", { season_number: -1 }],
    ["a fractional episode", { episode_number: 1.5 }],
    ["tags that are not an array", { tags: '"space"' }],
  ])("refuses %s", async (_, override) => {
    const db = await seeded();

    await expect(
      db
        .insertInto("metadata_corrections")
        .values({ ...CORRECTION, ...override })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
