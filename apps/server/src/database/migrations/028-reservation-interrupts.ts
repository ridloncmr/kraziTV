import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const reservationInterruptsMigration: Migration = {
  // Marks a reservation the owner chose to start inside the airing item,
  // cutting it at its start (ADR 0015). Kept after it starts, so the guide
  // can say it cut in; every earlier reservation interrupted nothing.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table reservations
      add column interrupts integer not null default 0
      constraint reservations_interrupts_boolean
      check (interrupts in (0, 1))`.execute(db);
  },

  // Drops the flag; every reservation then waits for what airs to finish.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("reservations")
      .dropColumn("interrupts")
      .execute();
  },
};
