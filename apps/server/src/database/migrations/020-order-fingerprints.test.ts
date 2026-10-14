import { afterEach, describe, expect, it } from "vitest";

import {
  collectionFixture,
  itemFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  channelFixture,
  collectionProgressFixture,
} from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

// Seeds what a progress row references.
async function seeded() {
  const { db } = await openTestDatabase();
  await db.insertInto("channels").values(channelFixture).execute();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_items").values(itemFixture).execute();
  await db.insertInto("media_collections").values(collectionFixture).execute();
  return db;
}

describe("020_order_fingerprints", () => {
  it("stores an ordered row's fingerprint and reads an existing row back as null", async () => {
    const db = await seeded();
    const episodeRow = {
      ...collectionProgressFixture,
      playback_mode: "episode",
      order_fingerprint: "0123456789abcdef",
    } as const;

    await db
      .insertInto("channel_collection_progress")
      .values([collectionProgressFixture, episodeRow])
      .execute();

    await expect(
      db
        .selectFrom("channel_collection_progress")
        .select(["playback_mode", "order_fingerprint"])
        .orderBy("playback_mode")
        .execute(),
    ).resolves.toEqual([
      { playback_mode: "chronological", order_fingerprint: null },
      { playback_mode: "episode", order_fingerprint: "0123456789abcdef" },
    ]);
  });

  it.each([
    ["an empty fingerprint", { order_fingerprint: "" }],
    [
      "a fingerprint on a random row",
      {
        playback_mode: "random",
        last_media_item_id: null,
        last_position: null,
        order_fingerprint: "0123456789abcdef",
      },
    ],
  ])("refuses %s", async (_label, override) => {
    const db = await seeded();

    await expect(
      db
        .insertInto("channel_collection_progress")
        // Typed as the valid row, since the override deliberately breaks it.
        .values({ ...collectionProgressFixture, ...(override as object) })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
