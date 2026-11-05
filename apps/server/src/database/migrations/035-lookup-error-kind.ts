import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const lookupErrorKindMigration: Migration = {
  // Stores which way a lookup failed beside its text (release-polish spec
  // 0005, decision 15), so Media Library chooses the owner's sentence by kind
  // and a reworded reason cannot change it. Failures stored before this
  // column keep a null kind; they are not re-classified from their text.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table metadata_matches
      add column lookup_error_kind text
      constraint metadata_matches_lookup_error_kind_known
      check (lookup_error_kind is null or (lookup_error is not null
        and lookup_error_kind in ('key_rejected', 'unreachable', 'http', 'unreadable')))`.execute(
      db,
    );
  },

  // Drops the kinds; each failure keeps its text.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("metadata_matches")
      .dropColumn("lookup_error_kind")
      .execute();
  },
};
