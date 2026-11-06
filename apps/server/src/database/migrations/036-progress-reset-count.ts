import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const progressResetCountMigration: Migration = {
  // Counts each progress reset, which random's seed derives from, so a
  // reshuffle starts a new order (release-polish decision 19). Existing
  // progress starts at 0, which keeps the seed it had, so upgrading
  // reorders no channel until its owner reshuffles.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table channel_collection_progress
      add column reset_count integer not null default 0
      constraint channel_collection_progress_reset_count_non_negative
      check (typeof(reset_count) = 'integer' and reset_count >= 0)`.execute(db);
  },

  // Drops the counts; every random order returns to the one before resets
  // counted.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("channel_collection_progress")
      .dropColumn("reset_count")
      .execute();
  },
};
