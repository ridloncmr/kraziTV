import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const correctedReleaseYearMigration: Migration = {
  // Lets the owner correct an item's release year (programming spec 0001),
  // stored as a year alone so release order and remake distinction read it
  // like any other `YYYY` date. Null leaves TMDB's date in force.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table metadata_corrections
      add column release_date text
      constraint metadata_corrections_release_date_valid
      check (release_date is null or release_date glob '[0-9][0-9][0-9][0-9]')`.execute(
      db,
    );
  },

  // Drops the corrected year; every other correction is untouched.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("metadata_corrections")
      .dropColumn("release_date")
      .execute();
  },
};
