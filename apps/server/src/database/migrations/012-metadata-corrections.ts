import { type Kysely, type RawBuilder, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

// Null, or text that is not blank once trimmed.
function nullableText(column: string): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return sql`${ref} is null or length(trim(${ref})) > 0`;
}

// Null, or an integer within `0..MAX_SAFE_INTEGER`.
function nullableCount(column: string): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return sql`${ref} is null or (typeof(${ref}) = 'integer' and ${ref} between 0 and ${MAX_SAFE_INTEGER})`;
}

export const metadataCorrectionsMigration: Migration = {
  // Adds the owner's per-field corrections and tags (programming spec 0001),
  // one row per item, dying with the item on purge. A separate table keeps
  // them out of reach of every write that replaces an item's match rows.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable("metadata_corrections")
      .addColumn("media_item_id", "text", (column) =>
        column.primaryKey().references("media_items.id").onDelete("cascade"),
      )
      .addColumn("title", "text")
      .addColumn("series_name", "text")
      .addColumn("season_number", "integer")
      .addColumn("episode_number", "integer")
      .addColumn("tags", "text", (column) => column.notNull())
      .addCheckConstraint(
        "metadata_corrections_title_valid",
        nullableText("title"),
      )
      .addCheckConstraint(
        "metadata_corrections_series_name_valid",
        nullableText("series_name"),
      )
      .addCheckConstraint(
        "metadata_corrections_season_number_valid",
        nullableCount("season_number"),
      )
      .addCheckConstraint(
        "metadata_corrections_episode_number_valid",
        nullableCount("episode_number"),
      )
      .addCheckConstraint(
        "metadata_corrections_tags_array",
        sql`json_valid(tags) and json_type(tags) = 'array'`,
      )
      .execute();
  },

  // Drops the corrections; match decisions and provider facts are untouched.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("metadata_corrections").execute();
  },
};
