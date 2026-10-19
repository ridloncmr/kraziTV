import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const programmingRevisionMigration: Migration = {
  // Counts the commits that changed a channel's planned programming as a
  // reservation preview shows it: a regeneration, an interruption, or a
  // reservation write. Coverage extension leaves it alone, so a save made
  // from a preview is not refused because a guide read extended the horizon
  // meanwhile (programming spec 0007). Existing channels start from their
  // schedule revision, so a preview made before the upgrade reads as stale
  // only if its schedule changed.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table channel_schedule_states
      add column programming_revision integer not null default 0
      constraint channel_schedule_states_programming_revision_non_negative
      check (typeof(programming_revision) = 'integer' and programming_revision >= 0)`.execute(
      db,
    );
    await sql`update channel_schedule_states
      set programming_revision = schedule_revision`.execute(db);
  },

  // Drops the counter; saves then compare the schedule revision again.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("channel_schedule_states")
      .dropColumn("programming_revision")
      .execute();
  },
};
