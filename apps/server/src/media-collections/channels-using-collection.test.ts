import { afterEach, describe, expect, it } from "vitest";

import { collectionFixture, rootFixture } from "../testing/catalog-fixtures.js";
import {
  channelFixture,
  programmingBlockFixture,
} from "../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";
import { findChannelsUsingCollection } from "./channels-using-collection.js";

afterEach(cleanUpTestEnvironment);

describe("findChannelsUsingCollection", () => {
  it("lists every channel whose block draws from the collection, in ID order", async () => {
    const { db } = await openTestDatabase();
    await db
      .insertInto("channels")
      .values([
        channelFixture,
        { ...channelFixture, id: "channel-second", number: "70" },
      ])
      .execute();
    await db.insertInto("media_roots").values(rootFixture).execute();
    await db
      .insertInto("media_collections")
      .values(collectionFixture)
      .execute();
    // Inserted second-channel first, so ID order cannot come from insert order.
    await db
      .insertInto("programming_blocks")
      .values([
        {
          ...programmingBlockFixture,
          id: "block-second",
          channel_id: "channel-second",
        },
        { ...programmingBlockFixture, playback_mode: "random" },
      ])
      .execute();

    await expect(
      findChannelsUsingCollection(db, collectionFixture.id),
    ).resolves.toEqual([channelFixture.id, "channel-second"]);
    await expect(
      findChannelsUsingCollection(db, "unused-collection"),
    ).resolves.toEqual([]);
  });
});
