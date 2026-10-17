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
      findChannelsUsingCollection(db, collectionFixture.id, 0),
    ).resolves.toEqual([channelFixture.id, "channel-second"]);
    await expect(
      findChannelsUsingCollection(db, "unused-collection", 0),
    ).resolves.toEqual([]);
  });

  it("counts a reservation of the collection only until it ends", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("channels").values(channelFixture).execute();
    await db.insertInto("media_roots").values(rootFixture).execute();
    await db
      .insertInto("media_collections")
      .values(collectionFixture)
      .execute();
    await db
      .insertInto("reservations")
      .values({
        id: "reservation-1",
        channel_id: channelFixture.id,
        starts_at: 1_000,
        ends_at: 2_000,
        end_kind: "explicit",
        source_kind: "collection",
        media_collection_id: collectionFixture.id,
        playback_mode: "chronological",
        created_at: 0,
        updated_at: 0,
      })
      .execute();

    await expect(
      findChannelsUsingCollection(db, collectionFixture.id, 1_999),
    ).resolves.toEqual([channelFixture.id]);
    await expect(
      findChannelsUsingCollection(db, collectionFixture.id, 2_000),
    ).resolves.toEqual([]);
  });
});
