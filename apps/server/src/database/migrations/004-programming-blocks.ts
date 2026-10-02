import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const programmingBlocksMigration: Migration = {
  // Adds programming blocks. A block dies with its channel, but its source
  // collection or item cannot be deleted while the block references it.
  // Kysely runs SQLite migrations without a transaction, so this one opens its own.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .createTable("programming_blocks")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("channel_id", "text", (column) =>
          column.notNull().references("channels.id").onDelete("cascade"),
        )
        .addColumn("source_kind", "text", (column) => column.notNull())
        .addColumn("media_collection_id", "text", (column) =>
          column.references("media_collections.id"),
        )
        .addColumn("media_item_id", "text", (column) =>
          column.references("media_items.id"),
        )
        .addColumn("playback_mode", "text")
        .addColumn("created_at", "integer", (column) => column.notNull())
        .addColumn("updated_at", "integer", (column) => column.notNull())
        // One check owns the either/or so a row can never carry a mixed source.
        // A check passes on NULL, so the mode is tested for null before `in`.
        .addCheckConstraint(
          "programming_blocks_source",
          sql`(source_kind = 'collection'
              and media_collection_id is not null
              and media_item_id is null
              and playback_mode is not null
              and playback_mode in ('chronological', 'random'))
            or (source_kind = 'media_item'
              and media_item_id is not null
              and media_collection_id is null
              and playback_mode is null)`,
        )
        .addCheckConstraint(
          "programming_blocks_created_at_safe_integer",
          sql`typeof(created_at) = 'integer' and created_at between 0 and ${MAX_SAFE_INTEGER}`,
        )
        .addCheckConstraint(
          "programming_blocks_updated_at_safe_integer",
          sql`typeof(updated_at) = 'integer' and updated_at between 0 and ${MAX_SAFE_INTEGER}`,
        )
        .execute();

      // The MVP's one-block limit is a separate index, so multi-block work can
      // drop it without rebuilding the table.
      await trx.schema
        .createIndex("programming_blocks_channel_id_unique")
        .on("programming_blocks")
        .column("channel_id")
        .unique()
        .execute();

      // Serves the foreign-key check on collection delete and "which channels
      // use this collection" lookups.
      await trx.schema
        .createIndex("programming_blocks_media_collection_id")
        .on("programming_blocks")
        .column("media_collection_id")
        .execute();

      // Serves the foreign-key check whenever a media item row is deleted.
      await trx.schema
        .createIndex("programming_blocks_media_item_id")
        .on("programming_blocks")
        .column("media_item_id")
        .execute();
    });
  },

  // Drops the table; its indexes go with it.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("programming_blocks").execute();
  },
};
