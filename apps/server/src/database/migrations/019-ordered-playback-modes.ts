import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// The mode lists as 004 and 005 wrote them into their CHECK constraints, and
// the list programming spec 0003 needs. Request validation still accepts
// only the modes kraziBrain schedules.
const NARROW_MODES = "playback_mode in ('chronological', 'random')";
const WIDE_MODES =
  "playback_mode in ('chronological', 'episode', 'release', 'random')";

// With enforcement off the order does not matter; these follow creation order.
const TABLES = ["programming_blocks", "schedule_entries"] as const;

export const orderedPlaybackModesMigration: Migration = {
  // Lets blocks and entries store the episode and release playback modes.
  // SQLite cannot alter a CHECK, so each table is rebuilt from its own stored
  // CREATE statement with only the mode list replaced, and its indexes are
  // recreated from their stored SQL, so nothing else about either table
  // changes.
  async up(db: Kysely<unknown>): Promise<void> {
    await rebuildWithModeList(db, NARROW_MODES, WIDE_MODES);
  },

  // Narrows the lists again. Fails on the CHECK if any block or entry still
  // uses an episode or release mode, rather than silently changing it.
  async down(db: Kysely<unknown>): Promise<void> {
    await rebuildWithModeList(db, WIDE_MODES, NARROW_MODES);
  },
};

/**
 * Rebuilds both tables with one mode list swapped for another. Schedule
 * entries reference blocks with ON DELETE SET NULL, so dropping the old
 * blocks table with enforcement on would strip every entry's block. SQLite's
 * table-rebuild procedure therefore turns enforcement off around one
 * transaction, checks every reference before committing, and always turns
 * enforcement back on.
 */
async function rebuildWithModeList(
  db: Kysely<unknown>,
  from: string,
  to: string,
): Promise<void> {
  await sql`pragma foreign_keys = off`.execute(db);
  try {
    await db.transaction().execute(async (trx) => {
      for (const table of TABLES) {
        await rebuildTable(trx, table, from, to);
      }
      const { rows } = await sql`pragma foreign_key_check`.execute(trx);
      if (rows.length > 0) {
        throw new Error(
          `Rebuilding playback mode constraints broke ${rows.length} foreign key reference(s)`,
        );
      }
    });
  } finally {
    await sql`pragma foreign_keys = on`.execute(db);
  }
}

/**
 * Recreates one table from its stored SQL with the mode list replaced,
 * copies every row, and recreates its indexes. Refuses a table whose SQL
 * does not hold the list exactly once, so it never rebuilds the wrong thing.
 */
async function rebuildTable(
  trx: Kysely<unknown>,
  table: string,
  from: string,
  to: string,
): Promise<void> {
  const { rows } = await sql<{ type: string; sql: string }>`
    select type, sql from sqlite_master
    where tbl_name = ${table} and sql is not null`.execute(trx);
  const create = rows.find((row) => row.type === "table")?.sql;
  if (create === undefined || create.split(from).length !== 2) {
    throw new Error(`${table} does not hold the expected playback mode list`);
  }
  const rebuilt = `${table}_rebuilt`;
  const renamed = create
    .replace(from, to)
    .replace(`"${table}"`, `"${rebuilt}"`);
  if (!renamed.includes(`"${rebuilt}"`)) {
    throw new Error(`${table} has an unexpected CREATE statement`);
  }

  await sql.raw(renamed).execute(trx);
  await sql`insert into ${sql.table(rebuilt)} select * from ${sql.table(table)}`.execute(
    trx,
  );
  await sql`drop table ${sql.table(table)}`.execute(trx);
  await sql`alter table ${sql.table(rebuilt)} rename to ${sql.table(table)}`.execute(
    trx,
  );
  for (const index of rows.filter((row) => row.type === "index")) {
    await sql.raw(index.sql).execute(trx);
  }
}
