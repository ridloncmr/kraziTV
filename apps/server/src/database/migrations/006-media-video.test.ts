import { afterEach, describe, expect, it } from "vitest";

import { itemFixtureAt, rootFixture } from "../../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

describe("006_media_video", () => {
  it("stores video presence as 0, 1, or null for items cataloged before it", async () => {
    const database = await openTestDatabase();
    await database.db.insertInto("media_roots").values(rootFixture).execute();

    for (const [index, hasVideo] of [0, 1, null].entries()) {
      await database.db
        .insertInto("media_items")
        .values(
          itemFixtureAt(`item-${index}`, `/media/movies/${index}.mkv`, {
            has_video: hasVideo,
          }),
        )
        .execute();
    }

    const rows = await database.db
      .selectFrom("media_items")
      .select("has_video")
      .orderBy("id")
      .execute();
    expect(rows.map((row) => row.has_video)).toEqual([0, 1, null]);
  });

  it("rejects a video presence that is not a boolean", async () => {
    const database = await openTestDatabase();
    await database.db.insertInto("media_roots").values(rootFixture).execute();

    await expect(
      database.db
        .insertInto("media_items")
        .values(
          itemFixtureAt("item-invalid", "/media/movies/invalid.mkv", {
            has_video: 2,
          }),
        )
        .execute(),
    ).rejects.toThrow(/constraint/i);
  });
});
