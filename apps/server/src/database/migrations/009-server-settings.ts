import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const serverSettingsMigration: Migration = {
  // Adds the one row of server-wide settings, starting with the owner's TMDB
  // key (ADR 0013). The key is stored as-is because it must be sent to TMDB.
  // Inserting the row here means every later read and write is one UPDATE.
  // Kysely runs SQLite migrations without a transaction, so this one opens its own.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .createTable("server_settings")
        .addColumn("id", "integer", (column) => column.primaryKey())
        .addColumn("tmdb_api_key", "text")
        .addCheckConstraint("server_settings_single_row", sql`id = 1`)
        .addCheckConstraint(
          "server_settings_tmdb_api_key_nonempty",
          sql`tmdb_api_key is null or length(trim(tmdb_api_key)) > 0`,
        )
        .execute();
      await sql`insert into server_settings (id, tmdb_api_key) values (1, null)`.execute(
        trx,
      );
    });
  },

  // Drops the settings row with its table.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("server_settings").execute();
  },
};
