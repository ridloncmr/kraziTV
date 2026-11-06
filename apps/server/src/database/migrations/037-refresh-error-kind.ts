import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const refreshErrorKindMigration: Migration = {
  // Stores which way a background refresh failed beside its text, as
  // migration 035 does for a lookup (release-polish decision 15), so Media
  // details names a rejected key rather than an outage. Failures stored
  // before this column keep a null kind; they are not re-classified from
  // their text.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table metadata_provider_refs
      add column refresh_error_kind text
      constraint metadata_provider_refs_refresh_error_kind_known
      check (refresh_error_kind is null or (refresh_error is not null
        and refresh_error_kind in ('key_rejected', 'unreachable', 'http', 'unreadable')))`.execute(
      db,
    );
  },

  // Drops the kinds; each refresh failure keeps its text.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("metadata_provider_refs")
      .dropColumn("refresh_error_kind")
      .execute();
  },
};
