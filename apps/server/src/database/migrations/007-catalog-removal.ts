import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const catalogRemovalMigration: Migration = {
  // Records when a user removed a root or item from the catalog. Removed rows
  // stay until purge, hidden from every read, because an airing entry may
  // still hold them. The index lets purge find removed items without a scan.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      for (const table of ["media_roots", "media_items"]) {
        await sql`alter table ${sql.table(table)} add column removed_at integer
          constraint ${sql.raw(`${table}_removed_at_safe_integer`)}
          check (removed_at is null or (typeof(removed_at) = 'integer' and removed_at between 0 and ${MAX_SAFE_INTEGER}))`.execute(
          trx,
        );
      }
      await trx.schema
        .createIndex("media_items_removed_at")
        .on("media_items")
        .column("removed_at")
        .execute();
    });
  },

  // Drops the index before the column it covers.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropIndex("media_items_removed_at").execute();
    await db.schema
      .alterTable("media_items")
      .dropColumn("removed_at")
      .execute();
    await db.schema
      .alterTable("media_roots")
      .dropColumn("removed_at")
      .execute();
  },
};
