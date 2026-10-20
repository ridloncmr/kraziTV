import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const assignmentNamesMigration: Migration = {
  // Lets the owner name a show, such as a set of cartoons as Adult Animation
  // (programming spec 0008). Null keeps naming it by its members, as every
  // existing assignment is; a stored name is never blank.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table programming_source_assignments
      add column name text
      constraint programming_source_assignments_name
      check (name is null or length(trim(name)) between 1 and 80)`.execute(db);
  },

  // Drops the names; every show is named by its members again.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("programming_source_assignments")
      .dropColumn("name")
      .execute();
  },
};
