import { type Kysely, type RawBuilder, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

// Requires a stored integer within `0..MAX_SAFE_INTEGER`, so a JavaScript
// number read back is always exact.
function safeTime(column: string): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return sql`typeof(${ref}) = 'integer' and ${ref} between 0 and ${MAX_SAFE_INTEGER}`;
}

export const accountsAndSessionsMigration: Migration = {
  // Adds the one account and its server-side sessions (ADR 0012). Sessions
  // store only a token hash, and die with their account.
  // Kysely runs SQLite migrations without a transaction, so this one opens its own.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .createTable("accounts")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("display_name", "text", (column) => column.notNull())
        .addColumn("avatar_id", "text", (column) => column.notNull())
        .addColumn("password_hash", "text", (column) => column.notNull())
        .addColumn("created_at", "integer", (column) => column.notNull())
        .addColumn("updated_at", "integer", (column) => column.notNull())
        .addCheckConstraint(
          "accounts_display_name_nonempty",
          sql`length(trim(display_name)) > 0`,
        )
        .addCheckConstraint(
          "accounts_created_at_safe_integer",
          safeTime("created_at"),
        )
        .addCheckConstraint(
          "accounts_updated_at_safe_integer",
          safeTime("updated_at"),
        )
        .execute();

      await trx.schema
        .createTable("sessions")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("account_id", "text", (column) =>
          column.notNull().references("accounts.id").onDelete("cascade"),
        )
        .addColumn("token_hash", "text", (column) => column.notNull().unique())
        .addColumn("created_at", "integer", (column) => column.notNull())
        .addColumn("expires_at", "integer", (column) => column.notNull())
        .addCheckConstraint(
          "sessions_created_at_safe_integer",
          safeTime("created_at"),
        )
        .addCheckConstraint(
          "sessions_expires_at_safe_integer",
          safeTime("expires_at"),
        )
        .execute();

      // Serves the cascade when the account is deleted.
      await trx.schema
        .createIndex("sessions_account_id")
        .on("sessions")
        .column("account_id")
        .execute();
    });
  },

  // Drops sessions before the accounts they reference; indexes go with them.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("sessions").execute();
    await db.schema.dropTable("accounts").execute();
  },
};
