import { type Kysely, sql } from "kysely";
import {
  type Migration,
  type MigrationProvider,
  Migrator,
} from "kysely/migration";

import type { DatabaseSchema } from "./schema.js";

const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

const initialCatalogMigration: Migration = {
  // Creates the complete initial catalog schema without ambient data or time.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable("media_roots")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("path", "text", (column) => column.notNull())
      .addColumn("path_key", "text", (column) => column.notNull().unique())
      .addColumn("enabled", "integer", (column) => column.notNull())
      .addColumn("created_at", "integer", (column) => column.notNull())
      .addColumn("updated_at", "integer", (column) => column.notNull())
      .addColumn("last_scanned_at", "integer")
      .addCheckConstraint("media_roots_enabled_boolean", sql`enabled in (0, 1)`)
      .addCheckConstraint(
        "media_roots_created_at_safe_integer",
        sql`typeof(created_at) = 'integer' and created_at between 0 and ${MAX_SAFE_INTEGER}`,
      )
      .addCheckConstraint(
        "media_roots_updated_at_safe_integer",
        sql`typeof(updated_at) = 'integer' and updated_at between 0 and ${MAX_SAFE_INTEGER}`,
      )
      .addCheckConstraint(
        "media_roots_last_scanned_at_safe_integer",
        sql`last_scanned_at is null or (typeof(last_scanned_at) = 'integer' and last_scanned_at between 0 and ${MAX_SAFE_INTEGER})`,
      )
      .execute();

    await db.schema
      .createTable("media_items")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("media_root_id", "text", (column) =>
        column.notNull().references("media_roots.id"),
      )
      .addColumn("path", "text", (column) => column.notNull())
      .addColumn("path_key", "text", (column) => column.notNull())
      .addColumn("title", "text", (column) => column.notNull())
      .addColumn("duration_ms", "integer")
      .addColumn("has_audio", "integer")
      .addColumn("status", "text", (column) => column.notNull())
      .addColumn("probe_error", "text")
      .addColumn("created_at", "integer", (column) => column.notNull())
      .addColumn("updated_at", "integer", (column) => column.notNull())
      .addColumn("last_seen_at", "integer", (column) => column.notNull())
      .addColumn("last_probed_at", "integer")
      .addUniqueConstraint("media_items_root_path_key_unique", [
        "media_root_id",
        "path_key",
      ])
      .addCheckConstraint(
        "media_items_duration_safe_integer",
        sql`duration_ms is null or (typeof(duration_ms) = 'integer' and duration_ms between 1 and ${MAX_SAFE_INTEGER})`,
      )
      .addCheckConstraint(
        "media_items_has_audio_boolean",
        sql`has_audio is null or has_audio in (0, 1)`,
      )
      .addCheckConstraint(
        "media_items_status_valid",
        sql`status in ('available', 'missing', 'probe_failed')`,
      )
      .addCheckConstraint(
        "media_items_probe_error_nonempty",
        sql`probe_error is null or length(trim(probe_error)) > 0`,
      )
      .addCheckConstraint(
        "media_items_available_metadata",
        sql`status != 'available' or (duration_ms is not null and has_audio is not null and probe_error is null)`,
      )
      .addCheckConstraint(
        "media_items_probe_failure_error",
        sql`status != 'probe_failed' or probe_error is not null`,
      )
      .addCheckConstraint(
        "media_items_created_at_safe_integer",
        sql`typeof(created_at) = 'integer' and created_at between 0 and ${MAX_SAFE_INTEGER}`,
      )
      .addCheckConstraint(
        "media_items_updated_at_safe_integer",
        sql`typeof(updated_at) = 'integer' and updated_at between 0 and ${MAX_SAFE_INTEGER}`,
      )
      .addCheckConstraint(
        "media_items_last_seen_at_safe_integer",
        sql`typeof(last_seen_at) = 'integer' and last_seen_at between 0 and ${MAX_SAFE_INTEGER}`,
      )
      .addCheckConstraint(
        "media_items_last_probed_at_safe_integer",
        sql`last_probed_at is null or (typeof(last_probed_at) = 'integer' and last_probed_at between 0 and ${MAX_SAFE_INTEGER})`,
      )
      .execute();
  },

  // Reverses the first migration in dependency order for disposable databases.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("media_items").execute();
    await db.schema.dropTable("media_roots").execute();
  },
};

const migrations: Readonly<Record<string, Migration>> = Object.freeze({
  "001_initial_catalog": initialCatalogMigration,
});

class CommittedMigrationProvider implements MigrationProvider {
  // Returns the fixed committed history so every environment sees the same order.
  async getMigrations(): Promise<Record<string, Migration>> {
    return { ...migrations };
  }
}

// Applies the committed migration history and surfaces the original migration error.
export async function migrateDatabase(
  db: Kysely<DatabaseSchema>,
): Promise<void> {
  const { error } = await new Migrator({
    db,
    provider: new CommittedMigrationProvider(),
  }).migrateToLatest();

  if (error !== undefined) {
    throw error;
  }
}
