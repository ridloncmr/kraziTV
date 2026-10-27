import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../schema/database-schema.js";
import {
  collectionFixture,
  itemFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  assignmentFixture,
  channelFixture,
  programmingBlockFixture,
  ruleFixture,
  ruleSourceFixture,
} from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { rulePriorityRangeMigration } from "./034-rule-priority-range.js";

afterEach(cleanUpTestEnvironment);

// Seeds a channel with the fixture assignment.
async function seeded() {
  const { db } = await openTestDatabase();
  await db.insertInto("channels").values(channelFixture).execute();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_items").values(itemFixture).execute();
  await db.insertInto("media_collections").values(collectionFixture).execute();
  await db
    .insertInto("programming_source_assignments")
    .values(assignmentFixture)
    .execute();
  return db;
}

// Inserts one rule per priority, the first selecting the fixture assignment
// and winning the fixture block, so the rebuild must keep both references.
async function insertRules(db: Kysely<DatabaseSchema>, priorities: number[]) {
  for (const [index, priority] of priorities.entries()) {
    await db
      .insertInto("programming_rules")
      .values({
        ...ruleFixture,
        id: `rule-${index}`,
        priority,
        rule_order: index,
      })
      .execute();
  }
  await db
    .insertInto("programming_rule_sources")
    .values({ ...ruleSourceFixture, rule_id: "rule-0" })
    .execute();
  await db
    .insertInto("programming_blocks")
    .values({ ...programmingBlockFixture, winning_rule_id: "rule-0" })
    .execute();
}

// Reads each rule's priority in saved order.
async function priorities(db: Kysely<DatabaseSchema>) {
  const rows = await db
    .selectFrom("programming_rules")
    .select("priority")
    .orderBy("rule_order")
    .execute();
  return rows.map((row) => row.priority);
}

// Reads the stored SQL of the rules table's indexes and triggers, so a
// rebuild can be checked for a dropped or altered one.
async function attachedSql(db: Kysely<DatabaseSchema>) {
  const { rows } = await sql<{ name: string; sql: string }>`
    select name, sql from sqlite_master
    where type in ('index', 'trigger') and sql is not null
      and tbl_name = 'programming_rules'
    order by name`.execute(db);
  return rows;
}

// Reads whether the connection enforces foreign keys.
async function foreignKeysOn(db: Kysely<DatabaseSchema>) {
  const { rows } = await sql<{
    foreign_keys: number;
  }>`pragma foreign_keys`.execute(db);
  return rows[0]?.foreign_keys === 1;
}

describe("034_rule_priority_range", () => {
  it("moves each priority by three, clamped to 1 through 5", async () => {
    const db = await seeded();
    const legacy = db as Kysely<unknown>;
    await rulePriorityRangeMigration.down?.(legacy);
    await insertRules(db, [0, -4, 9, 1, -2]);

    await rulePriorityRangeMigration.up(legacy);

    await expect(priorities(db)).resolves.toEqual([3, 1, 5, 4, 1]);
  });

  it("keeps rule sources, winning rules, indexes, and enforcement across the rebuild", async () => {
    const db = await seeded();
    const before = await attachedSql(db);
    const legacy = db as Kysely<unknown>;
    await rulePriorityRangeMigration.down?.(legacy);
    await insertRules(db, [0]);

    await rulePriorityRangeMigration.up(legacy);

    await expect(
      db.selectFrom("programming_rule_sources").selectAll().execute(),
    ).resolves.toEqual([{ ...ruleSourceFixture, rule_id: "rule-0" }]);
    await expect(
      db.selectFrom("programming_blocks").select("winning_rule_id").execute(),
    ).resolves.toEqual([{ winning_rule_id: "rule-0" }]);
    await expect(attachedSql(db)).resolves.toEqual(before);
    await expect(foreignKeysOn(db)).resolves.toBe(true);
    // The rebuilt table still cascades to its sources.
    await db.deleteFrom("programming_rules").execute();
    await expect(
      db.selectFrom("programming_rule_sources").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it.each([0, 6, -1])("refuses a stored priority of %d", async (priority) => {
    const db = await seeded();

    await expect(
      db
        .insertInto("programming_rules")
        .values({ ...ruleFixture, priority })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("moves priorities back by three on down", async () => {
    const db = await seeded();
    await insertRules(db, [1, 3, 5]);

    await rulePriorityRangeMigration.down?.(db as Kysely<unknown>);

    await expect(priorities(db)).resolves.toEqual([-2, 0, 2]);
  });
});
