import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const metadataRefreshMigration: Migration = {
  // Lets the six-month TMDB refresh (programming spec 0001) record why an
  // item's last refresh failed and when its expired provider facts were
  // dropped. Both sit beside `fetched_at`, since a match decision's own
  // lookup error is allowed only on unmatched items. Every write that
  // replaces an item's match rows starts both over as null.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("metadata_provider_refs")
      .addColumn("refresh_error", "text", (column) =>
        column.check(
          sql`refresh_error is null or length(trim(refresh_error)) > 0`,
        ),
      )
      .execute();
    await db.schema
      .alterTable("metadata_provider_refs")
      .addColumn("expired_at", "integer", (column) =>
        column.check(
          sql`expired_at is null or (typeof(expired_at) = 'integer' and expired_at between 0 and ${MAX_SAFE_INTEGER})`,
        ),
      )
      .execute();
  },

  // Drops both columns; fetched facts and references are untouched.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("metadata_provider_refs")
      .dropColumn("expired_at")
      .execute();
    await db.schema
      .alterTable("metadata_provider_refs")
      .dropColumn("refresh_error")
      .execute();
  },
};
