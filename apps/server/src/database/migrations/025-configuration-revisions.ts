import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const configurationRevisionsMigration: Migration = {
  // Counts each channel's programming configuration writes (programming spec
  // 0005), apart from its schedule revision, so a preview can tell it was
  // taken from older configuration. Existing channels start at 0.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table channel_programming_settings
      add column configuration_revision integer not null default 0
      constraint channel_programming_settings_configuration_revision
      check (typeof(configuration_revision) = 'integer'
        and configuration_revision between 0 and ${MAX_SAFE_INTEGER})`.execute(
      db,
    );
  },

  // Drops the counter; previews can no longer tell they are stale.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("channel_programming_settings")
      .dropColumn("configuration_revision")
      .execute();
  },
};
