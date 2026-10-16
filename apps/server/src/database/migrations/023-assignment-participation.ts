import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const assignmentParticipationMigration: Migration = {
  // Lets an assignment stay out of normal rotation until a programming rule
  // selects it (programming spec 0005). Existing assignments keep rotating.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table programming_source_assignments
      add column participation text not null default 'default'
      constraint programming_source_assignments_participation
      check (participation in ('default', 'rule_only'))`.execute(db);
  },

  // Drops the column; every assignment rotates again.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("programming_source_assignments")
      .dropColumn("participation")
      .execute();
  },
};
