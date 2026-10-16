import type { Kysely } from "kysely";
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
import { programmingRulesMigration } from "./024-programming-rules.js";

afterEach(cleanUpTestEnvironment);

// The checkpoint shape migrations 021 through 023 stored.
const FLAT_CHECKPOINT = {
  roundNumber: 2,
  pending: [assignmentFixture.id],
  served: ["earlier"],
  skipped: [],
  lastAiredAssignmentId: "earlier",
  nextMemberPositions: { [assignmentFixture.id]: 1 },
  marathonOpportunity: { assignmentId: assignmentFixture.id, started: false },
  roundCommittedProgram: true,
  ordinaryRoundsSinceMarathon: 4,
  rebuildCount: 3,
};

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

// Reads the only block's checkpoint back as JSON.
async function storedCheckpoint(db: Kysely<DatabaseSchema>) {
  const { checkpoint } = await db
    .selectFrom("programming_blocks")
    .select("checkpoint")
    .executeTakeFirstOrThrow();
  return JSON.parse(checkpoint) as unknown;
}

describe("024_programming_rules", () => {
  it("keeps an existing checkpoint's round as the default context", async () => {
    const db = await seeded();
    const legacy = db as Kysely<unknown>;
    await programmingRulesMigration.down?.(legacy);
    const {
      winning_rule_id: _,
      context_key: __,
      setting_origins: ___,
      ...legacyBlock
    } = programmingBlockFixture;
    await db
      .insertInto("programming_blocks")
      .values({
        ...legacyBlock,
        checkpoint: JSON.stringify(FLAT_CHECKPOINT),
      } as typeof programmingBlockFixture)
      .execute();

    await programmingRulesMigration.up(legacy);

    await expect(storedCheckpoint(db)).resolves.toEqual({
      activeContext: "default",
      contexts: {
        default: {
          roundNumber: 2,
          pending: [assignmentFixture.id],
          served: ["earlier"],
          skipped: [],
          unservedRemoved: [],
          marathonOpportunity: {
            assignmentId: assignmentFixture.id,
            started: false,
          },
          roundCommittedProgram: true,
        },
      },
      lastAiredAssignmentId: "earlier",
      nextMemberPositions: { [assignmentFixture.id]: 1 },
      ordinaryRoundsSinceMarathon: 4,
      rebuildCount: 3,
    });
    await expect(
      db
        .selectFrom("programming_blocks")
        .select(["winning_rule_id", "context_key", "setting_origins"])
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      winning_rule_id: null,
      context_key: "default",
      setting_origins: '{"ordinary":"assignment","marathon":"assignment"}',
    });
  });

  it("restores the flat checkpoint when rolled back", async () => {
    const db = await seeded();
    const legacy = db as Kysely<unknown>;
    await programmingRulesMigration.down?.(legacy);
    const {
      winning_rule_id: _,
      context_key: __,
      setting_origins: ___,
      ...legacyBlock
    } = programmingBlockFixture;
    await db
      .insertInto("programming_blocks")
      .values({
        ...legacyBlock,
        checkpoint: JSON.stringify(FLAT_CHECKPOINT),
      } as typeof programmingBlockFixture)
      .execute();
    await programmingRulesMigration.up(legacy);

    await programmingRulesMigration.down?.(legacy);

    await expect(storedCheckpoint(db)).resolves.toEqual(FLAT_CHECKPOINT);
  });

  it("drops a rule's reference when its assignment is deleted, keeping the rule", async () => {
    const db = await seeded();
    await db.insertInto("programming_rules").values(ruleFixture).execute();
    await db
      .insertInto("programming_rule_sources")
      .values(ruleSourceFixture)
      .execute();

    await db.deleteFrom("programming_source_assignments").execute();

    await expect(
      db.selectFrom("programming_rule_sources").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      db.selectFrom("programming_rules").select("id").execute(),
    ).resolves.toEqual([{ id: ruleFixture.id }]);
  });

  it("keeps a block as history with no winner once its rule is deleted", async () => {
    const db = await seeded();
    await db.insertInto("programming_rules").values(ruleFixture).execute();
    await db
      .insertInto("programming_blocks")
      .values({ ...programmingBlockFixture, winning_rule_id: ruleFixture.id })
      .execute();

    await db.deleteFrom("programming_rules").execute();

    await expect(
      db.selectFrom("programming_blocks").select("winning_rule_id").execute(),
    ).resolves.toEqual([{ winning_rule_id: null }]);
  });

  it.each<[string, Partial<typeof ruleFixture>]>([
    ["an unknown behavior", { behavior: "exclusive" as "join" }],
    ["an empty name", { name: " " }],
    ["a one-off range without dates", { date_kind: "one_off" }],
    [
      "a one-off range ending before it starts",
      {
        date_kind: "one_off",
        start_month_day: null,
        end_month_day: null,
        start_date: "2026-12-31",
        end_date: "2026-12-01",
      },
    ],
    ["annual dates in the wrong shape", { start_month_day: "12-1" }],
    ["a weekday mask past Saturday", { weekdays: 128 }],
    [
      "a window starting and ending together",
      { window_start_minute: 600, window_end_minute: 600 },
    ],
    ["half a window", { window_start_minute: 600 }],
  ])("refuses %s", async (_, override) => {
    const db = await seeded();

    await expect(
      db
        .insertInto("programming_rules")
        .values({ ...ruleFixture, ...override })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it.each<[string, Partial<typeof ruleSourceFixture>]>([
    ["an ordinary kind without a size", { ordinary_kind: "programs" }],
    ["a replaced marathon without a stretch", { marathon_mode: "replace" }],
    [
      "an inherited marathon with a stretch",
      { marathon_kind: "programs", marathon_min: 3 },
    ],
  ])("refuses a rule source with %s", async (_, override) => {
    const db = await seeded();
    await db.insertInto("programming_rules").values(ruleFixture).execute();

    await expect(
      db
        .insertInto("programming_rule_sources")
        .values({ ...ruleSourceFixture, ...override })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("refuses a rule source on another channel's assignment", async () => {
    const db = await seeded();
    await db
      .insertInto("channels")
      .values({ ...channelFixture, id: "other", number: "70" })
      .execute();
    await db
      .insertInto("programming_rules")
      .values({ ...ruleFixture, channel_id: "other" })
      .execute();

    await expect(
      db
        .insertInto("programming_rule_sources")
        .values({ ...ruleSourceFixture, channel_id: "other" })
        .execute(),
    ).rejects.toThrow(/FOREIGN KEY constraint/);
  });
});
