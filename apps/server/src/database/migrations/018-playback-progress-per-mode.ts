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

// Allows null, or a safe integer of at least zero.
function nullOrSafeIndex(column: string): RawBuilder<unknown> {
  return sql`${sql.ref(column)} is null or (${safeIntegerAtLeast(column, 0)})`;
}

export const playbackProgressPerModeMigration: Migration = {
  // Gives every playback mode its own progress row (ADR 0009, amended
  // 2026-10-13). Ordered modes record the last item they selected and its
  // ordered position; random keeps its selection index. Each old row splits
  // into a chronological and a random row. A chronological position N > 0
  // becomes the member N - 1 places into the collection's current order, so
  // the next pick (after it) is the member old N % count chose. The mode is
  // not listed here: blocks validate it, and a new mode needs no rebuild.
  // Kysely runs SQLite migrations without a transaction, so this one opens its own.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .createTable("channel_collection_progress_by_mode")
        .addColumn("channel_id", "text", (column) =>
          column.notNull().references("channels.id").onDelete("cascade"),
        )
        .addColumn("media_collection_id", "text", (column) =>
          column
            .notNull()
            .references("media_collections.id")
            .onDelete("cascade"),
        )
        .addColumn("playback_mode", "text", (column) => column.notNull())
        // Purge deletes the item; selection then falls back to the position.
        .addColumn("last_media_item_id", "text", (column) =>
          column.references("media_items.id").onDelete("set null"),
        )
        .addColumn("last_position", "integer")
        .addColumn("next_selection_index", "integer", (column) =>
          column.notNull(),
        )
        .addColumn("reset_sequence_number", "integer")
        .addColumn("updated_at", "integer", (column) => column.notNull())
        .addPrimaryKeyConstraint("channel_collection_progress_pk", [
          "channel_id",
          "media_collection_id",
          "playback_mode",
        ])
        .addCheckConstraint(
          "channel_collection_progress_last_position_safe_integer",
          nullOrSafeIndex("last_position"),
        )
        .addCheckConstraint(
          "channel_collection_progress_last_item_has_position",
          sql`last_media_item_id is null or last_position is not null`,
        )
        .addCheckConstraint(
          "channel_collection_progress_selection_index_safe_integer",
          safeIntegerAtLeast("next_selection_index", 0),
        )
        // A row holds only its own mode's progress.
        .addCheckConstraint(
          "channel_collection_progress_mode_fields",
          sql`(playback_mode = 'random' and last_media_item_id is null and last_position is null)
            or (playback_mode <> 'random' and next_selection_index = 0)`,
        )
        .addCheckConstraint(
          "channel_collection_progress_reset_sequence_number_safe_integer",
          nullOrSafeIndex("reset_sequence_number"),
        )
        .addCheckConstraint(
          "channel_collection_progress_updated_at_safe_integer",
          safeIntegerAtLeast("updated_at", 0),
        )
        .execute();

      // Positions may have gaps, so each member's place is its ordinal in
      // position order, as the scheduler indexes members.
      await sql`
        with ordinals as (
          select media_collection_id, media_item_id,
            row_number() over (partition by media_collection_id order by position) - 1 as ordinal,
            count(*) over (partition by media_collection_id) as member_count
          from media_collection_items
        ),
        counts as (
          select distinct media_collection_id, member_count from ordinals
        )
        insert into channel_collection_progress_by_mode
          (channel_id, media_collection_id, playback_mode, last_media_item_id,
            last_position, next_selection_index, reset_sequence_number, updated_at)
        select p.channel_id, p.media_collection_id, 'chronological', o.media_item_id,
          case
            when p.next_chronological_position = 0 then null
            -- No member to name: without an identity, selection resumes at
            -- the recorded position itself, so it keeps the old next pick.
            when c.member_count is null then p.next_chronological_position
            else (p.next_chronological_position - 1) % c.member_count
          end,
          0, null, p.updated_at
        from channel_collection_progress p
        left join counts c on c.media_collection_id = p.media_collection_id
        left join ordinals o on o.media_collection_id = p.media_collection_id
          and p.next_chronological_position > 0
          and o.ordinal = (p.next_chronological_position - 1) % c.member_count
        union all
        select channel_id, media_collection_id, 'random', null, null,
          next_random_selection_index, null, updated_at
        from channel_collection_progress`.execute(trx);

      await trx.schema.dropTable("channel_collection_progress").execute();
      await trx.schema
        .alterTable("channel_collection_progress_by_mode")
        .renameTo("channel_collection_progress")
        .execute();

      // Serve the cascade when a collection is deleted and the SET NULL
      // action when purge deletes an item.
      await trx.schema
        .createIndex("channel_collection_progress_media_collection_id")
        .on("channel_collection_progress")
        .column("media_collection_id")
        .execute();
      await trx.schema
        .createIndex("channel_collection_progress_last_media_item_id")
        .on("channel_collection_progress")
        .column("last_media_item_id")
        .execute();

      // Serves restoration's search for a channel's latest entry of one
      // collection and mode, which would otherwise scan the channel's history.
      await trx.schema
        .createIndex("schedule_entries_progress_restoration")
        .on("schedule_entries")
        .columns([
          "channel_id",
          "media_collection_id",
          "playback_mode",
          "sequence_number",
        ])
        .execute();
    });
  },

  // Folds the per-mode rows back into one row per channel and collection.
  // The chronological position resumes after the last recorded position;
  // episode and release progress have no place in the old shape and are lost.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .dropIndex("schedule_entries_progress_restoration")
        .execute();
      await trx.schema
        .createTable("channel_collection_progress_by_collection")
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

      await sql`
        insert into channel_collection_progress_by_collection
          (channel_id, media_collection_id, next_chronological_position,
            next_random_selection_index, updated_at)
        select channel_id, media_collection_id,
          coalesce(max(case when playback_mode = 'chronological' then last_position + 1 end), 0),
          coalesce(max(case when playback_mode = 'random' then next_selection_index end), 0),
          max(updated_at)
        from channel_collection_progress
        where playback_mode in ('chronological', 'random')
        group by channel_id, media_collection_id`.execute(trx);

      await trx.schema.dropTable("channel_collection_progress").execute();
      await trx.schema
        .alterTable("channel_collection_progress_by_collection")
        .renameTo("channel_collection_progress")
        .execute();
      await trx.schema
        .createIndex("channel_collection_progress_media_collection_id")
        .on("channel_collection_progress")
        .column("media_collection_id")
        .execute();
    });
  },
};
