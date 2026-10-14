import { randomUUID } from "node:crypto";

// The one derivation kraziBrain uses, imported rather than copied: 021
// only backfills states that exist when it runs, so replaying it on a fresh
// database writes no seed, and a copy here would be a cross-package copy.
import { deriveProgrammingSeed } from "@krazitv/krazi-brain";
import { type Kysely, type RawBuilder, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));
const MODES = sql.raw("('chronological', 'episode', 'release', 'random')");

// The ordinary stretch a converted collection loop gets (programming spec
// 0004 suggests three programs for episodes); a single item ignores its
// stretch and airs once per turn.
const CONVERTED_COLLECTION_COUNT = 3;
const CONVERTED_ITEM_COUNT = 1;

// Requires a stored integer within `min..MAX_SAFE_INTEGER`, so a JavaScript
// number read back is always exact.
function safeIntegerAtLeast(column: string, min: number): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return sql`typeof(${ref}) = 'integer' and ${ref} between ${sql.raw(String(min))} and ${MAX_SAFE_INTEGER}`;
}

// A stretch's columns: a positive count or minutes in `_min`, and `_max` at
// least that for a range only.
function stretchShape(prefix: string): RawBuilder<unknown> {
  const kind = sql.ref(`${prefix}_kind`);
  const max = sql.ref(`${prefix}_max`);
  return sql`${safeIntegerAtLeast(`${prefix}_min`, 1)}
    and ((${kind} in ('programs', 'airtime') and ${max} is null)
      or (${kind} = 'airtime_range' and ${max} is not null
        and ${safeIntegerAtLeast(`${prefix}_max`, 1)}
        and ${max} >= ${sql.ref(`${prefix}_min`)}))`;
}

/** One block row as migrations 004 through 020 left it. */
interface LegacyBlock {
  id: string;
  channel_id: string;
  source_kind: "collection" | "media_item";
  media_collection_id: string | null;
  media_item_id: string | null;
  playback_mode: string | null;
  created_at: number;
  updated_at: number;
}

export const sourceAssignmentsMigration: Migration = {
  // Moves channel programming onto source assignments (programming spec
  // 0004): each existing block becomes one assignment holding its one
  // source, and stays as that assignment's first generated block, so
  // covered entries keep their block and every collection's progress is
  // untouched. Blocks become history like entries, so their references
  // turn ON DELETE SET NULL and the one-block index goes. SQLite cannot
  // alter a foreign key, so the blocks table is rebuilt with enforcement off
  // around one transaction, as 019 does.
  async up(db: Kysely<unknown>): Promise<void> {
    await withForeignKeysOff(db, async (trx) => {
      await addScheduleStateColumns(trx);
      await createAssignmentTables(trx);
      await createBlocksTable(trx, "programming_blocks_generated");
      const blocks = (
        await sql<LegacyBlock>`select * from programming_blocks order by id`.execute(
          trx,
        )
      ).rows;
      for (const block of blocks) {
        await convertBlock(trx, block);
      }
      await sql`drop table programming_blocks`.execute(trx);
      await sql`alter table programming_blocks_generated rename to programming_blocks`.execute(
        trx,
      );
      await createBlockIndexes(trx);
    });
  },

  // Restores one configured block per channel. Fails on the one-block index
  // or the source check if a channel holds several blocks or a block lost
  // its source, rather than silently choosing which programming to keep.
  async down(db: Kysely<unknown>): Promise<void> {
    await withForeignKeysOff(db, async (trx) => {
      await sql`create table programming_blocks_configured (
        id text primary key,
        channel_id text not null references channels(id) on delete cascade,
        source_kind text not null,
        media_collection_id text references media_collections(id),
        media_item_id text references media_items(id),
        playback_mode text,
        created_at integer not null,
        updated_at integer not null,
        constraint programming_blocks_source check (
          (source_kind = 'collection'
            and media_collection_id is not null
            and media_item_id is null
            and playback_mode is not null
            and playback_mode in ${MODES})
          or (source_kind = 'media_item'
            and media_item_id is not null
            and media_collection_id is null
            and playback_mode is null)),
        constraint programming_blocks_created_at_safe_integer
          check (${safeIntegerAtLeast("created_at", 0)}),
        constraint programming_blocks_updated_at_safe_integer
          check (${safeIntegerAtLeast("updated_at", 0)})
      )`.execute(trx);
      await sql`insert into programming_blocks_configured
        select id, channel_id, source_kind, media_collection_id, media_item_id,
          playback_mode, created_at, updated_at
        from programming_blocks`.execute(trx);
      await sql`drop table programming_blocks`.execute(trx);
      await sql`alter table programming_blocks_configured rename to programming_blocks`.execute(
        trx,
      );
      await sql`create unique index programming_blocks_channel_id_unique
        on programming_blocks (channel_id)`.execute(trx);
      await sql`create index programming_blocks_media_collection_id
        on programming_blocks (media_collection_id)`.execute(trx);
      await sql`create index programming_blocks_media_item_id
        on programming_blocks (media_item_id)`.execute(trx);
      await sql`drop table programming_assignment_members`.execute(trx);
      await sql`drop table programming_source_assignments`.execute(trx);
      await sql`drop table channel_programming_settings`.execute(trx);
      for (const column of [
        "programming_seed",
        "rebuild_count",
        "last_rebuild_key",
      ]) {
        await sql`alter table channel_schedule_states drop column ${sql.raw(column)}`.execute(
          trx,
        );
      }
    });
  },
};

/**
 * Runs `work` in one transaction with foreign-key enforcement off, checks
 * every reference before committing, and always turns enforcement back on.
 * Entries reference blocks with ON DELETE SET NULL, so dropping the old
 * blocks table with enforcement on would strip every entry's block.
 */
async function withForeignKeysOff(
  db: Kysely<unknown>,
  work: (trx: Kysely<unknown>) => Promise<void>,
): Promise<void> {
  await sql`pragma foreign_keys = off`.execute(db);
  try {
    await db.transaction().execute(async (trx) => {
      await work(trx);
      const { rows } = await sql`pragma foreign_key_check`.execute(trx);
      if (rows.length > 0) {
        throw new Error(
          `Moving programming to source assignments broke ${rows.length} foreign key reference(s)`,
        );
      }
    });
  } finally {
    await sql`pragma foreign_keys = on`.execute(db);
  }
}

/**
 * Adds the programming seed, rebuild counter, and last rebuild key to every
 * schedule state, deriving each existing channel's seed from its anchor as
 * a first generation would.
 */
async function addScheduleStateColumns(trx: Kysely<unknown>): Promise<void> {
  await sql`alter table channel_schedule_states
    add column programming_seed integer not null default 0
    constraint channel_schedule_states_programming_seed_uint32
    check (typeof(programming_seed) = 'integer'
      and programming_seed between 0 and 4294967295)`.execute(trx);
  await sql`alter table channel_schedule_states
    add column rebuild_count integer not null default 0
    constraint channel_schedule_states_rebuild_count_safe_integer
    check (${safeIntegerAtLeast("rebuild_count", 0)})`.execute(trx);
  await sql`alter table channel_schedule_states
    add column last_rebuild_key text
    constraint channel_schedule_states_last_rebuild_key
    check (last_rebuild_key is null or length(last_rebuild_key) > 0)`.execute(
    trx,
  );
  const states = (
    await sql<{
      channel_id: string;
      anchor_time: number;
    }>`select channel_id, anchor_time from channel_schedule_states`.execute(trx)
  ).rows;
  for (const state of states) {
    await sql`update channel_schedule_states
      set programming_seed = ${deriveProgrammingSeed(state.channel_id, state.anchor_time)}
      where channel_id = ${state.channel_id}`.execute(trx);
  }
}

/** Creates assignments, their members, and channel programming settings. */
async function createAssignmentTables(trx: Kysely<unknown>): Promise<void> {
  await sql`create table programming_source_assignments (
    id text primary key,
    channel_id text not null references channels(id) on delete cascade,
    playback_mode text,
    assignment_order integer not null,
    ordinary_kind text not null,
    ordinary_min integer not null,
    ordinary_max integer,
    marathon_kind text,
    marathon_min integer,
    marathon_max integer,
    created_at integer not null,
    updated_at integer not null,
    -- Members name their channel, so this pair keys their foreign key.
    constraint programming_source_assignments_id_channel unique (id, channel_id),
    constraint programming_source_assignments_playback_mode
      check (playback_mode is null or playback_mode in ${MODES}),
    constraint programming_source_assignments_order
      check (${safeIntegerAtLeast("assignment_order", 0)}),
    constraint programming_source_assignments_ordinary
      check (${stretchShape("ordinary")}),
    constraint programming_source_assignments_marathon
      check ((marathon_kind is null and marathon_min is null and marathon_max is null)
        or (marathon_kind is not null and ${stretchShape("marathon")})),
    constraint programming_source_assignments_created_at_safe_integer
      check (${safeIntegerAtLeast("created_at", 0)}),
    constraint programming_source_assignments_updated_at_safe_integer
      check (${safeIntegerAtLeast("updated_at", 0)})
  )`.execute(trx);
  await sql`create index programming_source_assignments_channel_order
    on programming_source_assignments (channel_id, assignment_order)`.execute(
    trx,
  );

  // A member's collection or item cannot be deleted while it is assigned;
  // the API refuses first and the foreign key is the final guard.
  await sql`create table programming_assignment_members (
    assignment_id text not null,
    channel_id text not null references channels(id) on delete cascade,
    position integer not null,
    source_kind text not null,
    media_collection_id text references media_collections(id),
    media_item_id text references media_items(id),
    created_at integer not null,
    primary key (assignment_id, position),
    foreign key (assignment_id, channel_id)
      references programming_source_assignments(id, channel_id) on delete cascade,
    constraint programming_assignment_members_source check (
      (source_kind = 'collection'
        and media_collection_id is not null and media_item_id is null)
      or (source_kind = 'media_item'
        and media_item_id is not null and media_collection_id is null)),
    constraint programming_assignment_members_position
      check (${safeIntegerAtLeast("position", 0)}),
    constraint programming_assignment_members_created_at_safe_integer
      check (${safeIntegerAtLeast("created_at", 0)})
  )`.execute(trx);
  // Unique per channel; SQLite treats the other kind's nulls as distinct.
  await sql`create unique index programming_assignment_members_channel_collection
    on programming_assignment_members (channel_id, media_collection_id)`.execute(
    trx,
  );
  await sql`create unique index programming_assignment_members_channel_item
    on programming_assignment_members (channel_id, media_item_id)`.execute(trx);
  // Serve the foreign-key checks when a collection or item row is deleted.
  await sql`create index programming_assignment_members_media_collection_id
    on programming_assignment_members (media_collection_id)`.execute(trx);
  await sql`create index programming_assignment_members_media_item_id
    on programming_assignment_members (media_item_id)`.execute(trx);

  await sql`create table channel_programming_settings (
    channel_id text primary key references channels(id) on delete cascade,
    marathon_chance_percent integer not null default 0,
    marathon_min_ordinary_rounds integer not null default 2,
    created_at integer not null,
    updated_at integer not null,
    constraint channel_programming_settings_chance
      check (typeof(marathon_chance_percent) = 'integer'
        and marathon_chance_percent between 0 and 100),
    constraint channel_programming_settings_min_rounds
      check (${safeIntegerAtLeast("marathon_min_ordinary_rounds", 0)}),
    constraint channel_programming_settings_created_at_safe_integer
      check (${safeIntegerAtLeast("created_at", 0)}),
    constraint channel_programming_settings_updated_at_safe_integer
      check (${safeIntegerAtLeast("updated_at", 0)})
  )`.execute(trx);
}

/** Creates the generated-blocks table under `name`. */
async function createBlocksTable(
  trx: Kysely<unknown>,
  name: string,
): Promise<void> {
  await sql`create table ${sql.table(name)} (
    id text primary key,
    channel_id text not null references channels(id) on delete cascade,
    assignment_id text
      references programming_source_assignments(id) on delete set null,
    source_kind text not null,
    media_collection_id text references media_collections(id) on delete set null,
    media_item_id text references media_items(id) on delete set null,
    playback_mode text,
    round_number integer not null,
    turn_index integer not null,
    starts_at integer not null,
    resolved_kind text,
    resolved_value integer,
    marathon integer not null,
    checkpoint text not null,
    created_at integer not null,
    updated_at integer not null,
    -- A deleted source leaves its ID null; the kind and mode stay as history.
    constraint programming_blocks_source check (
      (source_kind = 'collection'
        and media_item_id is null
        and playback_mode is not null
        and playback_mode in ${MODES})
      or (source_kind = 'media_item'
        and media_collection_id is null
        and playback_mode is null)),
    constraint programming_blocks_round_number
      check (${safeIntegerAtLeast("round_number", 1)}),
    constraint programming_blocks_turn_index
      check (${safeIntegerAtLeast("turn_index", 0)}),
    constraint programming_blocks_starts_at
      check (${safeIntegerAtLeast("starts_at", 0)}),
    constraint programming_blocks_resolved check (
      (resolved_kind is null and resolved_value is null)
      or (resolved_kind in ('programs', 'airtime')
        and ${safeIntegerAtLeast("resolved_value", 1)})),
    constraint programming_blocks_marathon check (marathon in (0, 1)),
    constraint programming_blocks_checkpoint check (json_valid(checkpoint)),
    constraint programming_blocks_created_at_safe_integer
      check (${safeIntegerAtLeast("created_at", 0)}),
    constraint programming_blocks_updated_at_safe_integer
      check (${safeIntegerAtLeast("updated_at", 0)})
  )`.execute(trx);
}

/** Indexes the latest-block read and every foreign key's delete action. */
async function createBlockIndexes(trx: Kysely<unknown>): Promise<void> {
  await sql`create index programming_blocks_channel_id_starts_at
    on programming_blocks (channel_id, starts_at)`.execute(trx);
  await sql`create index programming_blocks_assignment_id
    on programming_blocks (assignment_id)`.execute(trx);
  await sql`create index programming_blocks_media_collection_id
    on programming_blocks (media_collection_id)`.execute(trx);
  await sql`create index programming_blocks_media_item_id
    on programming_blocks (media_item_id)`.execute(trx);
}

/**
 * Turns one configured block into an assignment holding its source as the
 * only member, and copies the block, under its own ID, as that
 * assignment's first generated turn: round one, starting at its first
 * entry, with the checkpoint from before it. Advancing past that turn marks
 * it served, so the next generation starts the next round.
 */
async function convertBlock(
  trx: Kysely<unknown>,
  block: LegacyBlock,
): Promise<void> {
  const assignmentId = randomUUID();
  const collection = block.source_kind === "collection";
  await sql`insert into programming_source_assignments (
      id, channel_id, playback_mode, assignment_order,
      ordinary_kind, ordinary_min, created_at, updated_at)
    values (${assignmentId}, ${block.channel_id}, ${block.playback_mode}, 0,
      'programs', ${collection ? CONVERTED_COLLECTION_COUNT : CONVERTED_ITEM_COUNT},
      ${block.created_at}, ${block.updated_at})`.execute(trx);
  await sql`insert into programming_assignment_members (
      assignment_id, channel_id, position, source_kind,
      media_collection_id, media_item_id, created_at)
    values (${assignmentId}, ${block.channel_id}, 0, ${block.source_kind},
      ${block.media_collection_id}, ${block.media_item_id}, ${block.created_at})`.execute(
    trx,
  );

  const first = (
    await sql<{ starts_at: number | null }>`
      select min(starts_at) as starts_at from schedule_entries
      where programming_block_id = ${block.id}`.execute(trx)
  ).rows[0]?.starts_at;
  const checkpoint = {
    roundNumber: 1,
    pending: [assignmentId],
    served: [],
    skipped: [],
    lastAiredAssignmentId: null,
    nextMemberPositions: { [assignmentId]: 0 },
    marathonOpportunity: null,
    roundCommittedProgram: false,
    ordinaryRoundsSinceMarathon: null,
  };
  await sql`insert into programming_blocks_generated (
      id, channel_id, assignment_id, source_kind, media_collection_id,
      media_item_id, playback_mode, round_number, turn_index, starts_at,
      resolved_kind, resolved_value, marathon, checkpoint, created_at, updated_at)
    values (${block.id}, ${block.channel_id}, ${assignmentId}, ${block.source_kind},
      ${block.media_collection_id}, ${block.media_item_id}, ${block.playback_mode},
      1, 0, ${first ?? block.created_at},
      ${collection ? "programs" : null},
      ${collection ? CONVERTED_COLLECTION_COUNT : null},
      0, ${JSON.stringify(checkpoint)}, ${block.created_at}, ${block.updated_at})`.execute(
    trx,
  );
}
