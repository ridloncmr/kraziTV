import { type Kysely, type RawBuilder, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));
const DEFAULT_ORIGINS = sql.raw(
  `'{"ordinary":"assignment","marathon":"assignment"}'`,
);

// Requires a stored integer within `min..MAX_SAFE_INTEGER`.
function safeIntegerAtLeast(column: string, min: string): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return sql`typeof(${ref}) = 'integer' and ${ref} between ${sql.raw(min)} and ${MAX_SAFE_INTEGER}`;
}

// A stretch's columns: a positive count or minutes in `_min`, and `_max` at
// least that for a range only.
function stretchShape(prefix: string): RawBuilder<unknown> {
  const kind = sql.ref(`${prefix}_kind`);
  const max = sql.ref(`${prefix}_max`);
  return sql`${safeIntegerAtLeast(`${prefix}_min`, "1")}
    and ((${kind} in ('programs', 'airtime') and ${max} is null)
      or (${kind} = 'airtime_range' and ${max} is not null
        and ${safeIntegerAtLeast(`${prefix}_max`, "1")}
        and ${max} >= ${sql.ref(`${prefix}_min`)}))`;
}

// Whether a stretch's three columns are all null.
function noStretch(prefix: string): RawBuilder<unknown> {
  return sql`${sql.ref(`${prefix}_kind`)} is null
    and ${sql.ref(`${prefix}_min`)} is null
    and ${sql.ref(`${prefix}_max`)} is null`;
}

/** A checkpoint as migrations 021 through 023 stored it: one round for the channel. */
interface FlatCheckpoint {
  roundNumber: number;
  pending: string[];
  served: string[];
  skipped: string[];
  lastAiredAssignmentId: string | null;
  nextMemberPositions: Record<string, number>;
  marathonOpportunity: { assignmentId: string; started: boolean } | null;
  roundCommittedProgram: boolean;
  ordinaryRoundsSinceMarathon: number | null;
  rebuildCount?: number;
}

/** A checkpoint with its rounds kept per rotation context. */
interface ContextCheckpoint {
  activeContext: string;
  contexts: Record<
    string,
    Pick<
      FlatCheckpoint,
      | "roundNumber"
      | "pending"
      | "served"
      | "skipped"
      | "marathonOpportunity"
      | "roundCommittedProgram"
    > & { unservedRemoved: string[] }
  >;
  lastAiredAssignmentId: string | null;
  nextMemberPositions: Record<string, number>;
  ordinaryRoundsSinceMarathon: number | null;
  rebuildCount: number;
}

export const programmingRulesMigration: Migration = {
  // Adds programming rules and their sources (programming spec 0005),
  // records which rule won each generated turn and the context it ran in,
  // and rewrites every stored checkpoint into per-context rounds, its old
  // round becoming the default context, so existing channels continue
  // exactly where they were.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await createRuleTables(trx);
      await sql`alter table programming_blocks
        add column winning_rule_id text
        references programming_rules(id) on delete set null`.execute(trx);
      await sql`create index programming_blocks_winning_rule_id
        on programming_blocks (winning_rule_id)`.execute(trx);
      await sql`alter table programming_blocks
        add column context_key text not null default 'default'
        constraint programming_blocks_context_key
        check (length(context_key) > 0)`.execute(trx);
      await sql`alter table programming_blocks
        add column setting_origins text not null default ${DEFAULT_ORIGINS}
        constraint programming_blocks_setting_origins
        check (json_valid(setting_origins))`.execute(trx);
      await rewriteCheckpoints(trx, toContexts);
    });
  },

  // Restores one round per channel from each block's active context and
  // drops rules. A turn a feature rule ran then reads as a default round.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await rewriteCheckpoints(trx, toFlat);
      await sql`drop index programming_blocks_winning_rule_id`.execute(trx);
      for (const column of [
        "winning_rule_id",
        "context_key",
        "setting_origins",
      ]) {
        await sql`alter table programming_blocks drop column ${sql.raw(column)}`.execute(
          trx,
        );
      }
      await sql`drop table programming_rule_sources`.execute(trx);
      await sql`drop table programming_rules`.execute(trx);
    });
  },
};

/** Creates rules and the sources each selects. */
async function createRuleTables(trx: Kysely<unknown>): Promise<void> {
  await sql`create table programming_rules (
    id text primary key,
    channel_id text not null references channels(id) on delete cascade,
    name text not null,
    behavior text not null,
    priority integer not null,
    rule_order integer not null,
    date_kind text not null,
    start_date text,
    end_date text,
    start_month_day text,
    end_month_day text,
    weekdays integer,
    window_start_minute integer,
    window_end_minute integer,
    created_at integer not null,
    updated_at integer not null,
    -- Sources name their channel, so this pair keys their foreign key.
    constraint programming_rules_id_channel unique (id, channel_id),
    constraint programming_rules_name check (length(trim(name)) > 0),
    constraint programming_rules_behavior check (behavior in ('join', 'feature')),
    constraint programming_rules_priority
      check (typeof(priority) = 'integer'
        and priority between -${MAX_SAFE_INTEGER} and ${MAX_SAFE_INTEGER}),
    constraint programming_rules_order
      check (${safeIntegerAtLeast("rule_order", "0")}),
    constraint programming_rules_dates check (
      (date_kind = 'any'
        and start_date is null and end_date is null
        and start_month_day is null and end_month_day is null)
      or (date_kind = 'one_off'
        and start_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        and end_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        and end_date >= start_date
        and start_month_day is null and end_month_day is null)
      or (date_kind = 'annual'
        and start_month_day glob '[0-9][0-9]-[0-9][0-9]'
        and end_month_day glob '[0-9][0-9]-[0-9][0-9]'
        and start_date is null and end_date is null)),
    constraint programming_rules_weekdays
      check (weekdays is null
        or (typeof(weekdays) = 'integer' and weekdays between 0 and 127)),
    constraint programming_rules_window check (
      (window_start_minute is null and window_end_minute is null)
      or (typeof(window_start_minute) = 'integer'
        and typeof(window_end_minute) = 'integer'
        and window_start_minute between 0 and 1439
        and window_end_minute between 0 and 1439
        and window_start_minute != window_end_minute)),
    constraint programming_rules_created_at_safe_integer
      check (${safeIntegerAtLeast("created_at", "0")}),
    constraint programming_rules_updated_at_safe_integer
      check (${safeIntegerAtLeast("updated_at", "0")})
  )`.execute(trx);
  await sql`create index programming_rules_channel_order
    on programming_rules (channel_id, rule_order)`.execute(trx);

  // Deleting an assignment is never blocked by rules: the reference goes.
  await sql`create table programming_rule_sources (
    rule_id text not null,
    channel_id text not null references channels(id) on delete cascade,
    assignment_id text not null,
    position integer not null,
    ordinary_kind text,
    ordinary_min integer,
    ordinary_max integer,
    marathon_mode text not null default 'inherit',
    marathon_kind text,
    marathon_min integer,
    marathon_max integer,
    created_at integer not null,
    primary key (rule_id, position),
    foreign key (rule_id, channel_id)
      references programming_rules(id, channel_id) on delete cascade,
    foreign key (assignment_id, channel_id)
      references programming_source_assignments(id, channel_id) on delete cascade,
    constraint programming_rule_sources_once unique (rule_id, assignment_id),
    constraint programming_rule_sources_position
      check (${safeIntegerAtLeast("position", "0")}),
    constraint programming_rule_sources_ordinary
      check ((${noStretch("ordinary")})
        or (ordinary_kind is not null and ${stretchShape("ordinary")})),
    constraint programming_rule_sources_marathon check (
      (marathon_mode in ('inherit', 'disabled') and ${noStretch("marathon")})
      or (marathon_mode = 'replace'
        and marathon_kind is not null and ${stretchShape("marathon")})),
    constraint programming_rule_sources_created_at_safe_integer
      check (${safeIntegerAtLeast("created_at", "0")})
  )`.execute(trx);
  // Serves the cascade when an assignment row is deleted.
  await sql`create index programming_rule_sources_assignment_id
    on programming_rule_sources (assignment_id, channel_id)`.execute(trx);
}

/** Rewrites every block's checkpoint JSON with `convert`. */
async function rewriteCheckpoints<T>(
  trx: Kysely<unknown>,
  convert: (checkpoint: T) => unknown,
): Promise<void> {
  const blocks = (
    await sql<{
      id: string;
      checkpoint: string;
    }>`select id, checkpoint from programming_blocks order by id`.execute(trx)
  ).rows;
  for (const block of blocks) {
    const rewritten = JSON.stringify(
      convert(JSON.parse(block.checkpoint) as T),
    );
    await sql`update programming_blocks set checkpoint = ${rewritten}
      where id = ${block.id}`.execute(trx);
  }
}

/** Keeps a flat checkpoint's round as the default context's. */
function toContexts(flat: FlatCheckpoint): ContextCheckpoint {
  return {
    activeContext: "default",
    contexts: {
      default: {
        roundNumber: flat.roundNumber,
        pending: flat.pending,
        served: flat.served,
        skipped: flat.skipped,
        unservedRemoved: [],
        marathonOpportunity: flat.marathonOpportunity,
        roundCommittedProgram: flat.roundCommittedProgram,
      },
    },
    lastAiredAssignmentId: flat.lastAiredAssignmentId,
    nextMemberPositions: flat.nextMemberPositions,
    ordinaryRoundsSinceMarathon: flat.ordinaryRoundsSinceMarathon,
    // Checkpoints from before fresh rebuilds belong to the first slate.
    rebuildCount: flat.rebuildCount ?? 0,
  };
}

/** Flattens a checkpoint to its active context's round. */
function toFlat(checkpoint: ContextCheckpoint): FlatCheckpoint {
  const round = checkpoint.contexts[checkpoint.activeContext];
  if (round === undefined) {
    throw new Error("A checkpoint has no round for its active context");
  }
  const { unservedRemoved: _, ...kept } = round;
  return {
    ...kept,
    lastAiredAssignmentId: checkpoint.lastAiredAssignmentId,
    nextMemberPositions: checkpoint.nextMemberPositions,
    ordinaryRoundsSinceMarathon: checkpoint.ordinaryRoundsSinceMarathon,
    rebuildCount: checkpoint.rebuildCount,
  };
}
