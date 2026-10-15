import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const turnsEndedByEditsMigration: Migration = {
  // Lets a turn-ending edit, a mode or stretch change, mark the started
  // turn so generation never continues it past the airing program
  // (programming spec 0004). Existing blocks read back as not ended.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table programming_blocks
      add column ended_by_edit integer not null default 0
      constraint programming_blocks_ended_by_edit
      check (ended_by_edit in (0, 1))`.execute(db);
  },

  // Drops the column; a flagged turn would then continue again.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("programming_blocks")
      .dropColumn("ended_by_edit")
      .execute();
  },
};
