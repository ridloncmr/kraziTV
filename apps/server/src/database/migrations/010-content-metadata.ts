import { type Kysely, type RawBuilder, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

// Requires a stored integer within `0..MAX_SAFE_INTEGER`, or null when
// allowed, so a JavaScript number read back is always exact.
function safeInteger(column: string, nullable = false): RawBuilder<unknown> {
  const ref = sql.ref(column);
  const check = sql`typeof(${ref}) = 'integer' and ${ref} between 0 and ${MAX_SAFE_INTEGER}`;
  return nullable ? sql`${ref} is null or (${check})` : check;
}

// A first-release date at year, month, or day precision, or null.
function partialDate(column: string): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return sql`${ref} is null or ${ref} glob '[0-9][0-9][0-9][0-9]' or ${ref} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]' or ${ref} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;
}

export const contentMetadataMigration: Migration = {
  // Adds content metadata beside the catalog (programming spec 0001): one
  // match decision per item, its accepted facts and TMDB reference, and the
  // candidates an ambiguous item offers. Each row dies with its item on purge.
  // Kysely runs SQLite migrations without a transaction, so this one opens its own.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .createTable("metadata_matches")
        .addColumn("media_item_id", "text", (column) =>
          column.primaryKey().references("media_items.id").onDelete("cascade"),
        )
        .addColumn("state", "text", (column) => column.notNull())
        .addColumn("extra", "integer", (column) => column.notNull())
        .addColumn("lookup_error", "text")
        .addColumn("looked_up_at", "integer")
        .addColumn("evidence", "text", (column) => column.notNull())
        .addColumn("matched_duration_ms", "integer")
        .addCheckConstraint(
          "metadata_matches_state_known",
          sql`state in ('unmatched', 'ambiguous', 'matched', 'rejected')`,
        )
        .addCheckConstraint(
          "metadata_matches_extra_boolean",
          sql`extra in (0, 1)`,
        )
        // An extra is never matched, and a failed lookup decided nothing.
        .addCheckConstraint(
          "metadata_matches_extra_unmatched",
          sql`extra = 0 or state = 'unmatched'`,
        )
        .addCheckConstraint(
          "metadata_matches_lookup_error_unmatched",
          sql`lookup_error is null or (state = 'unmatched' and length(trim(lookup_error)) > 0)`,
        )
        .addCheckConstraint(
          "metadata_matches_looked_up_at_safe_integer",
          safeInteger("looked_up_at", true),
        )
        .addCheckConstraint(
          "metadata_matches_matched_duration_ms_safe_integer",
          safeInteger("matched_duration_ms", true),
        )
        .execute();

      await trx.schema
        .createTable("content_facts")
        .addColumn("media_item_id", "text", (column) =>
          column.primaryKey().references("media_items.id").onDelete("cascade"),
        )
        .addColumn("content_type", "text", (column) => column.notNull())
        .addColumn("title", "text")
        .addColumn("release_date", "text")
        .addColumn("genres", "text", (column) => column.notNull())
        .addColumn("franchise_tmdb_id", "integer")
        .addColumn("franchise_name", "text")
        .addColumn("description", "text")
        .addColumn("poster_path", "text")
        .addCheckConstraint(
          "content_facts_content_type_known",
          sql`content_type in ('movie', 'episode', 'unknown')`,
        )
        .addCheckConstraint(
          "content_facts_release_date_partial",
          partialDate("release_date"),
        )
        .addCheckConstraint(
          "content_facts_genres_array",
          sql`json_valid(genres) and json_type(genres) = 'array'`,
        )
        .execute();

      await trx.schema
        .createTable("metadata_provider_refs")
        .addColumn("media_item_id", "text", (column) =>
          column.primaryKey().references("media_items.id").onDelete("cascade"),
        )
        .addColumn("provider", "text", (column) => column.notNull())
        .addColumn("external_kind", "text", (column) => column.notNull())
        .addColumn("external_id", "integer", (column) => column.notNull())
        .addColumn("fetched_at", "integer", (column) => column.notNull())
        .addCheckConstraint(
          "metadata_provider_refs_provider_known",
          sql`provider = 'tmdb' and external_kind = 'movie'`,
        )
        .addCheckConstraint(
          "metadata_provider_refs_external_id_safe_integer",
          safeInteger("external_id"),
        )
        .addCheckConstraint(
          "metadata_provider_refs_fetched_at_safe_integer",
          safeInteger("fetched_at"),
        )
        .execute();

      // The primary key's leading column serves the cascade on item purge.
      await trx.schema
        .createTable("metadata_match_candidates")
        .addColumn("media_item_id", "text", (column) =>
          column.notNull().references("media_items.id").onDelete("cascade"),
        )
        .addColumn("position", "integer", (column) => column.notNull())
        .addColumn("tmdb_id", "integer", (column) => column.notNull())
        .addColumn("title", "text", (column) => column.notNull())
        .addColumn("release_date", "text")
        .addColumn("poster_path", "text")
        .addPrimaryKeyConstraint("metadata_match_candidates_primary_key", [
          "media_item_id",
          "position",
        ])
        .addCheckConstraint(
          "metadata_match_candidates_release_date_partial",
          partialDate("release_date"),
        )
        .execute();
    });
  },

  // Drops every metadata table; the catalog itself is untouched.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("metadata_match_candidates").execute();
    await db.schema.dropTable("metadata_provider_refs").execute();
    await db.schema.dropTable("content_facts").execute();
    await db.schema.dropTable("metadata_matches").execute();
  },
};
