import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const reservationRequestKeysMigration: Migration = {
  // Remembers the browser's key for the save that created a reservation
  // (programming spec 0007), so a retried save finds it instead of creating
  // a second one. Null for reservations saved before keys existed.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table reservations
      add column request_key text
      constraint reservations_request_key_nonempty
      check (request_key is null or length(request_key) > 0)`.execute(db);
    await sql`create unique index reservations_channel_request_key
      on reservations (channel_id, request_key)
      where request_key is not null`.execute(db);
  },

  // Drops the keys; a retried save could then create a duplicate.
  async down(db: Kysely<unknown>): Promise<void> {
    await sql`drop index reservations_channel_request_key`.execute(db);
    await db.schema
      .alterTable("reservations")
      .dropColumn("request_key")
      .execute();
  },
};
