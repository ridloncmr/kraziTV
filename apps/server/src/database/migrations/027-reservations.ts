import { type Kysely, type RawBuilder, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));
const MODES = sql.raw(`('chronological', 'episode', 'release', 'random')`);

// Requires a stored integer within `min..MAX_SAFE_INTEGER`.
function safeIntegerAtLeast(column: string, min: string): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return sql`typeof(${ref}) = 'integer' and ${ref} between ${sql.raw(min)} and ${MAX_SAFE_INTEGER}`;
}

export const reservationsMigration: Migration = {
  // Adds reservations (programming spec 0006): exact-start reserved ranges
  // with what airs in them, and the block each one's programs air in. A
  // collection or item a reservation names cannot be deleted while it does,
  // as with assignments. A block keeps its reservation's ID as plain
  // history with no foreign key: generation must still recognize a block
  // that took no rotation turn after its reservation is deleted.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await sql`create table reservations (
        id text primary key,
        channel_id text not null references channels(id) on delete cascade,
        starts_at integer not null,
        ends_at integer not null,
        end_kind text not null,
        source_kind text not null,
        media_collection_id text references media_collections(id),
        playback_mode text,
        created_at integer not null,
        updated_at integer not null,
        constraint reservations_starts_at
          check (${safeIntegerAtLeast("starts_at", "0")}),
        constraint reservations_range
          check (${safeIntegerAtLeast("ends_at", "0")} and ends_at > starts_at),
        constraint reservations_end_kind
          check (end_kind in ('explicit', 'program_derived')),
        -- A collection needs an explicit end: how many programs fit is
        -- unknown when it is saved.
        constraint reservations_source check (
          (source_kind = 'collection'
            and media_collection_id is not null
            and playback_mode is not null
            and playback_mode in ${MODES}
            and end_kind = 'explicit')
          or (source_kind = 'media_items'
            and media_collection_id is null
            and playback_mode is null)),
        constraint reservations_created_at_safe_integer
          check (${safeIntegerAtLeast("created_at", "0")}),
        constraint reservations_updated_at_safe_integer
          check (${safeIntegerAtLeast("updated_at", "0")})
      )`.execute(trx);
      await sql`create index reservations_channel_id_starts_at
        on reservations (channel_id, starts_at)`.execute(trx);
      await sql`create index reservations_media_collection_id
        on reservations (media_collection_id)`.execute(trx);
      await sql`create table reservation_items (
        reservation_id text not null
          references reservations(id) on delete cascade,
        position integer not null,
        media_item_id text not null references media_items(id),
        primary key (reservation_id, position),
        constraint reservation_items_position
          check (${safeIntegerAtLeast("position", "0")})
      )`.execute(trx);
      await sql`create index reservation_items_media_item_id
        on reservation_items (media_item_id)`.execute(trx);
      await sql`alter table programming_blocks
        add column reservation_id text`.execute(trx);
    });
  },

  // Drops reservations and the block column naming them.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await sql`alter table programming_blocks
        drop column reservation_id`.execute(trx);
      await sql`drop table reservation_items`.execute(trx);
      await sql`drop table reservations`.execute(trx);
    });
  },
};
