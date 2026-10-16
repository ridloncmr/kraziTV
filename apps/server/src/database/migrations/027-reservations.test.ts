import type { Insertable, Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../schema/database-schema.js";
import type { ReservationTable } from "../schema/reservation-table.js";
import {
  collectionFixture,
  itemFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import { channelFixture } from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { reservationsMigration } from "./027-reservations.js";

afterEach(cleanUpTestEnvironment);

const HOUR = 60 * 60 * 1000;

// A one-hour media-item reservation on the fixture channel.
const reservation: Insertable<ReservationTable> = {
  id: "reservation-1",
  channel_id: channelFixture.id,
  starts_at: 10 * HOUR,
  ends_at: 11 * HOUR,
  end_kind: "program_derived",
  source_kind: "media_items",
  media_collection_id: null,
  playback_mode: null,
  created_at: 0,
  updated_at: 0,
};

// The catalog and channel a reservation references.
async function seeded(): Promise<Kysely<DatabaseSchema>> {
  const { db } = await openTestDatabase();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_items").values(itemFixture).execute();
  await db.insertInto("media_collections").values(collectionFixture).execute();
  await db.insertInto("channels").values(channelFixture).execute();
  return db;
}

describe("027_reservations", () => {
  it("stores a media-item reservation with its items in order", async () => {
    const db = await seeded();
    await db.insertInto("reservations").values(reservation).execute();
    await db
      .insertInto("reservation_items")
      .values({
        reservation_id: reservation.id,
        position: 0,
        media_item_id: itemFixture.id,
      })
      .execute();

    await expect(
      db.selectFrom("reservation_items").selectAll().execute(),
    ).resolves.toHaveLength(1);
  });

  it.each([
    ["an end before the start", { ends_at: 9 * HOUR }],
    ["an unknown end kind", { end_kind: "approximate" as "explicit" }],
    [
      "a collection without an explicit end",
      {
        source_kind: "collection" as const,
        media_collection_id: collectionFixture.id,
        playback_mode: "chronological" as const,
      },
    ],
    [
      "a collection without a mode",
      {
        source_kind: "collection" as const,
        end_kind: "explicit" as const,
        media_collection_id: collectionFixture.id,
      },
    ],
    ["a media-item list naming a mode", { playback_mode: "random" as const }],
  ])("refuses %s", async (_, overrides) => {
    const db = await seeded();

    await expect(
      db
        .insertInto("reservations")
        .values({ ...reservation, ...overrides })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("refuses deleting a media item or collection a reservation names", async () => {
    const db = await seeded();
    await db
      .insertInto("reservations")
      .values([
        reservation,
        {
          ...reservation,
          id: "reservation-2",
          starts_at: 12 * HOUR,
          ends_at: 13 * HOUR,
          end_kind: "explicit",
          source_kind: "collection",
          media_collection_id: collectionFixture.id,
          playback_mode: "chronological",
        },
      ])
      .execute();
    await db
      .insertInto("reservation_items")
      .values({
        reservation_id: reservation.id,
        position: 0,
        media_item_id: itemFixture.id,
      })
      .execute();

    await expect(
      db.deleteFrom("media_items").where("id", "=", itemFixture.id).execute(),
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      db
        .deleteFrom("media_collections")
        .where("id", "=", collectionFixture.id)
        .execute(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("deletes a reservation's items with it", async () => {
    const db = await seeded();
    await db.insertInto("reservations").values(reservation).execute();
    await db
      .insertInto("reservation_items")
      .values({
        reservation_id: reservation.id,
        position: 0,
        media_item_id: itemFixture.id,
      })
      .execute();

    await db.deleteFrom("reservations").execute();

    await expect(
      db.selectFrom("reservation_items").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("migrates down and up again", async () => {
    const { db } = await openTestDatabase();
    const legacy = db as Kysely<unknown>;

    await reservationsMigration.down?.(legacy);
    await reservationsMigration.up(legacy);

    await expect(
      db.selectFrom("reservations").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});
