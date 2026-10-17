import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { channelFixture } from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { reservationInterruptsMigration } from "./028-reservation-interrupts.js";

afterEach(cleanUpTestEnvironment);

const HOUR = 60 * 60 * 1000;

// A one-hour collection-free reservation row with only the required columns.
const reservation = {
  id: "reservation-1",
  channel_id: channelFixture.id,
  starts_at: 10 * HOUR,
  ends_at: 11 * HOUR,
  end_kind: "program_derived" as const,
  source_kind: "media_items" as const,
  media_collection_id: null,
  playback_mode: null,
  created_at: 0,
  updated_at: 0,
};

describe("028_reservation_interrupts", () => {
  it("defaults to not interrupting and accepts only 0 or 1", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("channels").values(channelFixture).execute();
    await db.insertInto("reservations").values(reservation).execute();

    await expect(
      db.selectFrom("reservations").select("interrupts").execute(),
    ).resolves.toEqual([{ interrupts: 0 }]);
    await expect(
      db
        .insertInto("reservations")
        .values({
          ...reservation,
          id: "reservation-2",
          starts_at: 12 * HOUR,
          ends_at: 13 * HOUR,
          interrupts: 2,
        })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("migrates down and up again", async () => {
    const { db } = await openTestDatabase();
    const legacy = db as Kysely<unknown>;

    await reservationInterruptsMigration.down?.(legacy);
    await reservationInterruptsMigration.up(legacy);

    await expect(
      db.selectFrom("reservations").select("interrupts").execute(),
    ).resolves.toEqual([]);
  });
});
