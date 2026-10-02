import { type Kysely, type RawBuilder, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

// Requires a stored integer within `min..MAX_SAFE_INTEGER`, so a JavaScript
// number read back is always exact.
function safeIntegerAtLeast(column: string, min: number): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return sql`typeof(${ref}) = 'integer' and ${ref} between ${sql.raw(String(min))} and ${MAX_SAFE_INTEGER}`;
}

export const schedulesMigration: Migration = {
  // Adds materialized schedules: per-channel state, guide-visible entries, and
  // per-collection playback progress. All three die with their channel.
  // Kysely runs SQLite migrations without a transaction, so this one opens its own.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .createTable("channel_schedule_states")
        .addColumn("channel_id", "text", (column) =>
          column.primaryKey().references("channels.id").onDelete("cascade"),
        )
        .addColumn("seed", "integer", (column) => column.notNull())
        .addColumn("anchor_time", "integer", (column) => column.notNull())
        .addColumn("last_generated_through", "integer", (column) =>
          column.notNull(),
        )
        .addColumn("next_sequence_number", "integer", (column) =>
          column.notNull(),
        )
        .addColumn("schedule_revision", "integer", (column) => column.notNull())
        .addColumn("created_at", "integer", (column) => column.notNull())
        .addColumn("updated_at", "integer", (column) => column.notNull())
        .addCheckConstraint(
          "channel_schedule_states_seed_uint32",
          sql`typeof(seed) = 'integer' and seed between 0 and 4294967295`,
        )
        .addCheckConstraint(
          "channel_schedule_states_anchor_time_safe_integer",
          safeIntegerAtLeast("anchor_time", 0),
        )
        .addCheckConstraint(
          "channel_schedule_states_last_generated_through_safe_integer",
          sql`${safeIntegerAtLeast("last_generated_through", 0)}
            and last_generated_through >= anchor_time`,
        )
        .addCheckConstraint(
          "channel_schedule_states_next_sequence_number_safe_integer",
          safeIntegerAtLeast("next_sequence_number", 0),
        )
        .addCheckConstraint(
          "channel_schedule_states_schedule_revision_safe_integer",
          safeIntegerAtLeast("schedule_revision", 1),
        )
        .addCheckConstraint(
          "channel_schedule_states_created_at_safe_integer",
          safeIntegerAtLeast("created_at", 0),
        )
        .addCheckConstraint(
          "channel_schedule_states_updated_at_safe_integer",
          safeIntegerAtLeast("updated_at", 0),
        )
        .execute();

      await trx.schema
        .createTable("channel_collection_progress")
        .addColumn("channel_id", "text", (column) =>
          column.notNull().references("channels.id").onDelete("cascade"),
        )
        .addColumn("media_collection_id", "text", (column) =>
          column
            .notNull()
            .references("media_collections.id")
            .onDelete("cascade"),
        )
        .addColumn("next_chronological_position", "integer", (column) =>
          column.notNull(),
        )
        .addColumn("next_random_selection_index", "integer", (column) =>
          column.notNull(),
        )
        .addColumn("updated_at", "integer", (column) => column.notNull())
        .addPrimaryKeyConstraint("channel_collection_progress_pk", [
          "channel_id",
          "media_collection_id",
        ])
        .addCheckConstraint(
          "channel_collection_progress_chronological_safe_integer",
          safeIntegerAtLeast("next_chronological_position", 0),
        )
        .addCheckConstraint(
          "channel_collection_progress_random_safe_integer",
          safeIntegerAtLeast("next_random_selection_index", 0),
        )
        .addCheckConstraint(
          "channel_collection_progress_updated_at_safe_integer",
          safeIntegerAtLeast("updated_at", 0),
        )
        .execute();

      // Serves the cascade when a collection is deleted.
      await trx.schema
        .createIndex("channel_collection_progress_media_collection_id")
        .on("channel_collection_progress")
        .column("media_collection_id")
        .execute();

      await trx.schema
        .createTable("schedule_entries")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("channel_id", "text", (column) =>
          column.notNull().references("channels.id").onDelete("cascade"),
        )
        .addColumn("media_item_id", "text", (column) =>
          column.notNull().references("media_items.id"),
        )
        .addColumn("title", "text", (column) => column.notNull())
        .addColumn("starts_at", "integer", (column) => column.notNull())
        .addColumn("ends_at", "integer", (column) => column.notNull())
        .addColumn("duration_ms", "integer", (column) => column.notNull())
        .addColumn("sequence_number", "integer", (column) => column.notNull())
        // Entries outlive their block and collection as history.
        .addColumn("programming_block_id", "text", (column) =>
          column.references("programming_blocks.id").onDelete("set null"),
        )
        .addColumn("media_collection_id", "text", (column) =>
          column.references("media_collections.id").onDelete("set null"),
        )
        .addColumn("playback_mode", "text")
        .addColumn("playback_index", "integer")
        .addColumn("created_at", "integer", (column) => column.notNull())
        .addColumn("updated_at", "integer", (column) => column.notNull())
        .addCheckConstraint(
          "schedule_entries_title_nonempty",
          sql`length(trim(title)) > 0`,
        )
        .addCheckConstraint(
          "schedule_entries_times",
          sql`${safeIntegerAtLeast("starts_at", 0)}
            and ${safeIntegerAtLeast("duration_ms", 1)}
            and ends_at = starts_at + duration_ms`,
        )
        .addCheckConstraint(
          "schedule_entries_sequence_number_safe_integer",
          safeIntegerAtLeast("sequence_number", 0),
        )
        // A check passes on NULL, so the pair is tested for null together
        // before the mode and index are range-checked.
        .addCheckConstraint(
          "schedule_entries_playback",
          sql`(playback_mode is null and playback_index is null)
            or (playback_mode is not null
              and playback_mode in ('chronological', 'random')
              and playback_index is not null
              and ${safeIntegerAtLeast("playback_index", 0)})`,
        )
        .addCheckConstraint(
          "schedule_entries_created_at_safe_integer",
          safeIntegerAtLeast("created_at", 0),
        )
        .addCheckConstraint(
          "schedule_entries_updated_at_safe_integer",
          safeIntegerAtLeast("updated_at", 0),
        )
        .execute();

      // Sequence numbers order a channel's entries and are never reused.
      await trx.schema
        .createIndex("schedule_entries_channel_id_sequence_number_unique")
        .on("schedule_entries")
        .columns(["channel_id", "sequence_number"])
        .unique()
        .execute();

      // Serve window reads and the regeneration boundary.
      await trx.schema
        .createIndex("schedule_entries_channel_id_starts_at")
        .on("schedule_entries")
        .columns(["channel_id", "starts_at"])
        .execute();
      await trx.schema
        .createIndex("schedule_entries_channel_id_ends_at")
        .on("schedule_entries")
        .columns(["channel_id", "ends_at"])
        .execute();

      // Serve the SET NULL actions and the media item foreign-key check.
      await trx.schema
        .createIndex("schedule_entries_programming_block_id")
        .on("schedule_entries")
        .column("programming_block_id")
        .execute();
      await trx.schema
        .createIndex("schedule_entries_media_collection_id")
        .on("schedule_entries")
        .column("media_collection_id")
        .execute();
      await trx.schema
        .createIndex("schedule_entries_media_item_id")
        .on("schedule_entries")
        .column("media_item_id")
        .execute();
    });
  },

  // Drops the tables; their indexes go with them.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("schedule_entries").execute();
    await db.schema.dropTable("channel_collection_progress").execute();
    await db.schema.dropTable("channel_schedule_states").execute();
  },
};
