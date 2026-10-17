import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { channelFixture } from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { reservationRequestKeysMigration } from "./029-reservation-request-keys.js";

afterEach(cleanUpTestEnvironment);

const HOUR = 60 * 60 * 1000;

// A one-hour reservation row saved with `request_key`, `hours` from zero.
const reservation = (id: string, hours: number, requestKey: string | null) => ({
  id,
  channel_id: channelFixture.id,
  starts_at: hours * HOUR,
  ends_at: (hours + 1) * HOUR,
  end_kind: "program_derived" as const,
  source_kind: "media_items" as const,
  media_collection_id: null,
  playback_mode: null,
  request_key: requestKey,
  created_at: 0,
  updated_at: 0,
});

describe("029_reservation_request_keys", () => {
  it("keeps one reservation per channel and key, and any number without one", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("channels").values(channelFixture).execute();
    await db
      .insertInto("reservations")
      .values([
        reservation("a", 1, "key-1"),
        reservation("b", 3, null),
        reservation("c", 5, null),
      ])
      .execute();

    await expect(
      db
        .insertInto("reservations")
        .values(reservation("d", 7, "key-1"))
        .execute(),
    ).rejects.toThrow(/UNIQUE constraint/);
    await expect(
      db
        .insertInto("reservations")
        .values(reservation("e", 9, ""))
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
    // Keys are per channel, so another channel may reuse one.
    await db
      .insertInto("channels")
      .values({ ...channelFixture, id: "channel-other", number: "70" })
      .execute();
    await expect(
      db
        .insertInto("reservations")
        .values({
          ...reservation("f", 11, "key-1"),
          channel_id: "channel-other",
        })
        .execute(),
    ).resolves.toBeDefined();
  });

  it("migrates down and up again", async () => {
    const { db } = await openTestDatabase();
    const legacy = db as Kysely<unknown>;

    await reservationRequestKeysMigration.down?.(legacy);
    await reservationRequestKeysMigration.up(legacy);

    await expect(
      db.selectFrom("reservations").select("request_key").execute(),
    ).resolves.toEqual([]);
  });
});
