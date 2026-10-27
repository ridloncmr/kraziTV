import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// The priority bounds as 024 wrote them into its CHECK, and the 1 through 5
// scale combined rules use (programming spec 0009). Each migration keeps its
// own copy so committed history never shifts under a shared edit.
const WIDE_RANGE = `priority between -${Number.MAX_SAFE_INTEGER} and ${Number.MAX_SAFE_INTEGER}`;
const NARROW_RANGE = "priority between 1 and 5";
const TABLE = "programming_rules";

export const rulePriorityRangeMigration: Migration = {
  // Narrows rule priority to 1 through 5. Each priority moves by three,
  // clamped, so the old default 0 becomes the new default 3 and every rule
  // keeps its side of it. SQLite cannot alter a CHECK, so the table is
  // rebuilt from its stored CREATE statement with only the range replaced.
  async up(db: Kysely<unknown>): Promise<void> {
    await withForeignKeysOff(db, async (trx) => {
      await sql`update programming_rules
        set priority = max(1, min(5, priority + 3))`.execute(trx);
      await rebuildWithRange(trx, WIDE_RANGE, NARROW_RANGE);
    });
  },

  // Widens the range again and moves each priority back by three, so a rule
  // at the new default 3 returns to the old default 0.
  async down(db: Kysely<unknown>): Promise<void> {
    await withForeignKeysOff(db, async (trx) => {
      await rebuildWithRange(trx, NARROW_RANGE, WIDE_RANGE);
      await sql`update programming_rules set priority = priority - 3`.execute(
        trx,
      );
    });
  },
};

/**
 * Runs `work` in one transaction with foreign-key enforcement off, checks
 * every reference before committing, and always turns enforcement back on.
 * Rule sources cascade from rules and blocks set their winning rule null, so
 * dropping the old rules table with enforcement on would strip both.
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
          `Rebuilding the rule priority range broke ${rows.length} foreign key reference(s)`,
        );
      }
    });
  } finally {
    await sql`pragma foreign_keys = on`.execute(db);
  }
}

/**
 * Recreates the rules table from its stored SQL with one priority range
 * swapped for another, copies every row, and recreates its indexes and
 * triggers. Refuses SQL that does not hold the range exactly once, so it
 * never rebuilds the wrong thing.
 */
async function rebuildWithRange(
  trx: Kysely<unknown>,
  from: string,
  to: string,
): Promise<void> {
  const { rows } = await sql<{ type: string; sql: string }>`
    select type, sql from sqlite_master
    where tbl_name = ${TABLE} and sql is not null`.execute(trx);
  const create = rows.find((row) => row.type === "table")?.sql;
  if (create === undefined || create.split(from).length !== 2) {
    throw new Error(`${TABLE} does not hold the expected priority range`);
  }
  const rebuilt = `${TABLE}_rebuilt`;
  // SQLite stores the leading keywords uppercased and the name as last
  // written: unquoted from 024, quoted after a rebuild's rename.
  const head = new RegExp(`^create table "?${TABLE}"? \\(`, "i");
  if (!head.test(create)) {
    throw new Error(`${TABLE} has an unexpected CREATE statement`);
  }
  const renamed = create
    .replace(from, to)
    .replace(head, `create table "${rebuilt}" (`);

  await sql.raw(renamed).execute(trx);
  await sql`insert into ${sql.table(rebuilt)} select * from ${sql.table(TABLE)}`.execute(
    trx,
  );
  await sql`drop table ${sql.table(TABLE)}`.execute(trx);
  await sql`alter table ${sql.table(rebuilt)} rename to ${sql.table(TABLE)}`.execute(
    trx,
  );
  for (const attached of rows.filter((row) => row.type !== "table")) {
    await sql.raw(attached.sql).execute(trx);
  }
}
