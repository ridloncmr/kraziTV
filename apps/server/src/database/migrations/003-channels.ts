import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const channelsMigration: Migration = {
  // Adds channel identity. Numbers are unique across enabled and disabled channels.
  // Kysely runs SQLite migrations without a transaction, so this one opens its own.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .createTable("channels")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("number", "text", (column) => column.notNull().unique())
        .addColumn("name", "text", (column) => column.notNull())
        .addColumn("enabled", "integer", (column) => column.notNull())
        .addColumn("created_at", "integer", (column) => column.notNull())
        .addColumn("updated_at", "integer", (column) => column.notNull())
        // SQLite has no regex, so GLOB clauses spell out [1-9][0-9]*(\.[1-9][0-9]*)?:
        // leading non-zero digit, only digits and dots, at most one dot, and a
        // subchannel that is present and has no leading zero.
        .addCheckConstraint(
          "channels_number_canonical",
          sql`typeof(number) = 'text'
            and number glob '[1-9]*'
            and number not glob '*[^0-9.]*'
            and number not glob '*.*.*'
            and number not glob '*.'
            and number not glob '*.0*'`,
        )
        .addCheckConstraint(
          "channels_name_nonempty",
          sql`length(trim(name)) > 0`,
        )
        .addCheckConstraint("channels_enabled_boolean", sql`enabled in (0, 1)`)
        .addCheckConstraint(
          "channels_created_at_safe_integer",
          sql`typeof(created_at) = 'integer' and created_at between 0 and ${MAX_SAFE_INTEGER}`,
        )
        .addCheckConstraint(
          "channels_updated_at_safe_integer",
          sql`typeof(updated_at) = 'integer' and updated_at between 0 and ${MAX_SAFE_INTEGER}`,
        )
        .execute();
    });
  },

  // Drops the channel table; nothing references it yet.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("channels").execute();
  },
};
