import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const collectionExclusionsMigration: Migration = {
  // Records the owner's decisions to keep one item out of one automatic
  // collection (programming spec 0002). They are decisions, never
  // membership rows, so programming never reads them. Each dies with its
  // collection, and with its item when purge deletes the item's row.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable("media_collection_exclusions")
      .addColumn("media_collection_id", "text", (column) =>
        column.notNull().references("media_collections.id").onDelete("cascade"),
      )
      .addColumn("media_item_id", "text", (column) =>
        column.notNull().references("media_items.id").onDelete("cascade"),
      )
      .addColumn("created_at", "integer", (column) =>
        column
          .notNull()
          .check(
            sql`typeof(created_at) = 'integer' and created_at between 0 and ${MAX_SAFE_INTEGER}`,
          ),
      )
      .addPrimaryKeyConstraint("media_collection_exclusions_pk", [
        "media_collection_id",
        "media_item_id",
      ])
      .execute();
    // The key leads with the collection, so purge's item-side cascade needs its own index.
    await db.schema
      .createIndex("media_collection_exclusions_media_item_id")
      .on("media_collection_exclusions")
      .column("media_item_id")
      .execute();
  },

  // Drops the exclusions; collections and their membership stay.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("media_collection_exclusions").execute();
  },
};
