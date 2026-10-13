import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const collectionMaintenanceMigration: Migration = {
  // Lets a collection be maintained from a saved criterion (programming spec
  // 0002). Every existing collection reads back `manual` with no criterion,
  // so its behavior is unchanged. Membership rows keep their shape (ADR
  // 0006). Only an automatic collection holds a criterion or diagnostics;
  // the mode column, added last, checks that across all of them.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("media_collections")
      .addColumn("criterion", "text", (column) =>
        column.check(
          sql`criterion is null or (json_valid(criterion) and json_type(criterion) = 'object')`,
        ),
      )
      .execute();
    await db.schema
      .alterTable("media_collections")
      .addColumn("maintained_at", "integer", (column) =>
        column.check(
          sql`maintained_at is null or (typeof(maintained_at) = 'integer' and maintained_at between 0 and ${MAX_SAFE_INTEGER})`,
        ),
      )
      .execute();
    await db.schema
      .alterTable("media_collections")
      .addColumn("maintenance_error", "text", (column) =>
        column.check(
          sql`maintenance_error is null or length(trim(maintenance_error)) > 0`,
        ),
      )
      .execute();
    await db.schema
      .alterTable("media_collections")
      .addColumn("maintenance_incomplete", "integer", (column) =>
        column.check(
          sql`maintenance_incomplete is null or maintenance_incomplete in (0, 1)`,
        ),
      )
      .execute();
    await db.schema
      .alterTable("media_collections")
      .addColumn("maintenance_mode", "text", (column) =>
        column
          .notNull()
          .defaultTo("manual")
          .check(
            sql`(maintenance_mode = 'automatic' and criterion is not null) or (maintenance_mode = 'manual' and criterion is null and maintained_at is null and maintenance_error is null and maintenance_incomplete is null)`,
          ),
      )
      .execute();
  },

  // Drops the maintenance columns; collections and their membership stay.
  async down(db: Kysely<unknown>): Promise<void> {
    for (const column of [
      "maintenance_mode",
      "maintenance_incomplete",
      "maintenance_error",
      "maintained_at",
      "criterion",
    ]) {
      await db.schema
        .alterTable("media_collections")
        .dropColumn(column)
        .execute();
    }
  },
};
