import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { RecordSources } from "../database/writes/record-sources.js";
import type {
  CreateRuleResult,
  DeleteRuleResult,
  ReorderRulesResult,
  RuleSettings,
  SavedRule,
  UnknownAssignmentResult,
  UpdateRuleResult,
} from "./contracts.js";
import { readRules, toRuleColumns } from "./rule-rows.js";

type Executor = Kysely<DatabaseSchema>;

/**
 * Persists programming rules and the sources they select. Writes take the
 * caller's pinned executor and effective time because they run only inside
 * a schedule input change, whose regeneration commits in the same
 * immediate transaction.
 */
export class RuleRepository {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;

  // The ID source is injectable so tests can assert exact IDs.
  constructor(
    db: Kysely<DatabaseSchema>,
    options: Pick<RecordSources, "createId"> = {},
  ) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
  }

  /** Lists a channel's rules in saved order; an unknown channel simply has none. */
  async listForChannel(channelId: string): Promise<SavedRule[]> {
    return readRules(this.#db, channelId);
  }

  /**
   * Adds a rule after the channel's others in saved order. Every source must
   * be one of the channel's assignments; the check shares the write's
   * immediate transaction, and the foreign key is the final guard.
   */
  async create(
    trx: Executor,
    channelId: string,
    settings: RuleSettings,
    now: number,
  ): Promise<CreateRuleResult> {
    const channel = await trx
      .selectFrom("channels")
      .select("id")
      .where("id", "=", channelId)
      .executeTakeFirst();
    if (channel === undefined) return { kind: "channel_not_found" };
    const unknown = await findUnknownAssignment(trx, channelId, settings);
    if (unknown !== undefined) return unknown;
    const last = await trx
      .selectFrom("programming_rules")
      .select((eb) => eb.fn.max("rule_order").as("order"))
      .where("channel_id", "=", channelId)
      .executeTakeFirst();
    const id = this.#createId();
    await trx
      .insertInto("programming_rules")
      .values({
        id,
        channel_id: channelId,
        rule_order: (last?.order ?? -1) + 1,
        ...toRuleColumns(settings),
        created_at: now,
        updated_at: now,
      })
      .execute();
    await writeSources(trx, channelId, id, settings, now);
    return { kind: "created", rule: await readRule(trx, channelId, id) };
  }

  /**
   * Replaces a rule's settings and sources; one owned by another channel is
   * not found. Identical settings write nothing and report `unchanged`, so
   * callers can skip regeneration.
   */
  async update(
    trx: Executor,
    channelId: string,
    ruleId: string,
    settings: RuleSettings,
    now: number,
  ): Promise<UpdateRuleResult> {
    const [current] = await readRules(trx, channelId, ruleId);
    if (current === undefined) return { kind: "not_found" };
    if (isSameSettings(current, settings)) {
      return { kind: "unchanged", rule: current };
    }
    const unknown = await findUnknownAssignment(trx, channelId, settings);
    if (unknown !== undefined) return unknown;
    await trx
      .updateTable("programming_rules")
      .set({ ...toRuleColumns(settings), updated_at: now })
      .where("id", "=", ruleId)
      .execute();
    await trx
      .deleteFrom("programming_rule_sources")
      .where("rule_id", "=", ruleId)
      .execute();
    await writeSources(trx, channelId, ruleId, settings, now);
    return { kind: "updated", rule: await readRule(trx, channelId, ruleId) };
  }

  /**
   * Saves a new rule order for the channel, which breaks priority ties. The
   * same order writes nothing and reports `unchanged`, so callers can skip
   * regeneration.
   */
  async reorder(
    trx: Executor,
    channelId: string,
    ruleIds: readonly string[],
    now: number,
  ): Promise<ReorderRulesResult> {
    const channel = await trx
      .selectFrom("channels")
      .select("id")
      .where("id", "=", channelId)
      .executeTakeFirst();
    if (channel === undefined) return { kind: "channel_not_found" };
    const current = (await readRules(trx, channelId)).map(({ id }) => id);
    if (
      new Set(ruleIds).size !== ruleIds.length ||
      [...ruleIds].sort().join() !== [...current].sort().join()
    ) {
      return { kind: "mismatch", ruleIds: current };
    }
    const changed = ruleIds.join() !== current.join();
    if (changed) {
      for (const [order, id] of ruleIds.entries()) {
        await trx
          .updateTable("programming_rules")
          .set({ rule_order: order, updated_at: now })
          .where("id", "=", id)
          .execute();
      }
    }
    return {
      kind: changed ? "reordered" : "unchanged",
      rules: await readRules(trx, channelId),
    };
  }

  /** Removes a rule and its sources; one owned by another channel is not found. */
  async delete(
    trx: Executor,
    channelId: string,
    ruleId: string,
  ): Promise<DeleteRuleResult> {
    const result = await trx
      .deleteFrom("programming_rules")
      .where("id", "=", ruleId)
      .where("channel_id", "=", channelId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n
      ? { kind: "deleted" }
      : { kind: "not_found" };
  }
}

// Reads one rule the write just saved, which must exist.
async function readRule(
  trx: Executor,
  channelId: string,
  ruleId: string,
): Promise<SavedRule> {
  const [rule] = await readRules(trx, channelId, ruleId);
  if (rule === undefined) throw new Error(`Rule ${ruleId} was not saved`);
  return rule;
}

// Inserts a rule's sources in saved order, each inheriting its assignment's settings.
async function writeSources(
  trx: Executor,
  channelId: string,
  ruleId: string,
  settings: RuleSettings,
  now: number,
): Promise<void> {
  await trx
    .insertInto("programming_rule_sources")
    .values(
      settings.sources.map(({ assignmentId }, position) => ({
        rule_id: ruleId,
        channel_id: channelId,
        assignment_id: assignmentId,
        position,
        ordinary_kind: null,
        ordinary_min: null,
        ordinary_max: null,
        marathon_mode: "inherit" as const,
        marathon_kind: null,
        marathon_min: null,
        marathon_max: null,
        created_at: now,
      })),
    )
    .execute();
}

// Reports the first source that is not one of the channel's assignments.
async function findUnknownAssignment(
  trx: Executor,
  channelId: string,
  settings: RuleSettings,
): Promise<UnknownAssignmentResult | undefined> {
  const known = new Set(
    (
      await trx
        .selectFrom("programming_source_assignments")
        .select("id")
        .where("channel_id", "=", channelId)
        .execute()
    ).map(({ id }) => id),
  );
  const unknown = settings.sources.find(
    ({ assignmentId }) => !known.has(assignmentId),
  );
  return unknown === undefined
    ? undefined
    : { kind: "unknown_assignment", assignmentId: unknown.assignmentId };
}

// Compares settings by their stored form, so field and weekday order never matter.
function isSameSettings(current: RuleSettings, next: RuleSettings): boolean {
  const normalized = (settings: RuleSettings) =>
    JSON.stringify([toRuleColumns(settings), settings.sources]);
  return normalized(current) === normalized(next);
}
