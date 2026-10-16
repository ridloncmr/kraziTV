import { afterEach, describe, expect, it } from "vitest";

import {
  collectionFixture,
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
import { findChannelsUsingCollection } from "./channels-using-collection.js";
import { insertCollectionAssignment } from "../../testing/schedule-fixtures.js";

afterEach(cleanUpTestEnvironment);

describe("findChannelsUsingCollection", () => {
  it("lists every channel with an assignment of the collection, in ID order", async () => {
    const { db } = await openTestDatabase();
    await db
      .insertInto("channels")
      .values([
        channelFixture,
        { ...channelFixture, id: "channel-second", number: "70" },
        { ...channelFixture, id: "channel-third", number: "71" },
      ])
      .execute();
    await db.insertInto("media_roots").values(rootFixture).execute();
    await db
      .insertInto("media_collections")
      .values(collectionFixture)
      .execute();
    // Inserted second-channel first, so ID order cannot come from insert order.
    await insertCollectionAssignment(db, {
      id: "assignment-second",
      channelId: "channel-second",
    });
    await insertCollectionAssignment(db);
    // A generated block is history, not configuration, so it never counts.
    await db
      .insertInto("programming_blocks")
      .values({ ...programmingBlockFixture, channel_id: "channel-third" })
      .execute();

    await expect(
      findChannelsUsingCollection(db, collectionFixture.id),
    ).resolves.toEqual([channelFixture.id, "channel-second"]);
    await expect(
      findChannelsUsingCollection(db, "unused-collection"),
    ).resolves.toEqual([]);
  });
});
