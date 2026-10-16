import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const programmingTimezoneMigration: Migration = {
  // Remembers the programming timezone schedules were last generated in
  // (programming spec 0005), so a restart under another one regenerates
  // channels with rules once. Null until the first startup records it.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table server_settings
      add column programming_timezone text
      constraint server_settings_programming_timezone_nonempty
      check (programming_timezone is null
        or length(trim(programming_timezone)) > 0)`.execute(db);
  },

  // Drops the remembered timezone; the next startup records it again.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("server_settings")
      .dropColumn("programming_timezone")
      .execute();
  },
};
