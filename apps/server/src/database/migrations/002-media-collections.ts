import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const mediaCollectionsMigration: Migration = {
  // Adds collections and their explicit item order; membership dies with its collection.
  // Kysely runs SQLite migrations without a transaction, so this one opens its own:
  // a partial create on a populated database would otherwise block every later startup.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .createTable("media_collections")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("name", "text", (column) => column.notNull())
        .addColumn("created_at", "integer", (column) => column.notNull())
        .addColumn("updated_at", "integer", (column) => column.notNull())
        .addCheckConstraint(
          "media_collections_name_nonempty",
          sql`length(trim(name)) > 0`,
        )
        .addCheckConstraint(
          "media_collections_created_at_safe_integer",
          sql`typeof(created_at) = 'integer' and created_at between 0 and ${MAX_SAFE_INTEGER}`,
        )
        .addCheckConstraint(
          "media_collections_updated_at_safe_integer",
          sql`typeof(updated_at) = 'integer' and updated_at between 0 and ${MAX_SAFE_INTEGER}`,
        )
        .execute();

      await trx.schema
        .createTable("media_collection_items")
        .addColumn("media_collection_id", "text", (column) =>
          column
            .notNull()
            .references("media_collections.id")
            .onDelete("cascade"),
        )
        .addColumn("media_item_id", "text", (column) =>
          column.notNull().references("media_items.id"),
        )
        .addColumn("position", "integer", (column) => column.notNull())
        .addColumn("created_at", "integer", (column) => column.notNull())
        .addPrimaryKeyConstraint("media_collection_items_position_pk", [
          "media_collection_id",
          "position",
        ])
        .addUniqueConstraint("media_collection_items_item_unique", [
          "media_collection_id",
          "media_item_id",
        ])
        .addCheckConstraint(
          "media_collection_items_position_safe_integer",
          sql`typeof(position) = 'integer' and position between 0 and ${MAX_SAFE_INTEGER}`,
        )
        .addCheckConstraint(
          "media_collection_items_created_at_safe_integer",
          sql`typeof(created_at) = 'integer' and created_at between 0 and ${MAX_SAFE_INTEGER}`,
        )
        .execute();

      // Both composite keys lead with the collection, so item-side lookups need their own
      // index: foreign-key checks on item removal and "which collections hold this item".
      await trx.schema
        .createIndex("media_collection_items_media_item_id")
        .on("media_collection_items")
        .column("media_item_id")
        .execute();
    });
  },

  // Drops membership before the collections it references.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("media_collection_items").execute();
    await db.schema.dropTable("media_collections").execute();
  },
};
