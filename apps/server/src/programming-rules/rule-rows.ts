import {
  type CalendarConditions,
  findRuleSourceProblem,
  type ProgrammingRule,
  type RuleSource,
  type StretchSetting,
} from "@krazitv/krazi-brain";
import type { Kysely, Selectable } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ProgrammingRuleSourceTable } from "../database/schema/programming-rule-source-table.js";
import type { ProgrammingRuleTable } from "../database/schema/programming-rule-table.js";
import {
  toStretch,
  toStretchColumns,
} from "../schedules/persistence/assignment-sources.js";
import type {
  RuleSettings,
  RuleSourceSettings,
  RuleStretchConflict,
  SavedRule,
} from "./contracts.js";

// The rule rows of a channel: written from the API's settings and read back
// as the API's rules or as kraziPlan's. The only codec of stored rules, so
// every reader agrees on what a row means.

type Executor = Kysely<DatabaseSchema>;

/** Flattens a rule's own settings into its columns; sources are rows of their own. */
export function toRuleColumns(settings: RuleSettings) {
  const { dates, weekdays, window } = settings;
  return {
    name: settings.name,
    behavior: settings.behavior,
    priority: settings.priority,
    date_kind: dates.kind,
    start_date: dates.kind === "one_off" ? dates.startDate : null,
    end_date: dates.kind === "one_off" ? dates.endDate : null,
    start_month_day: dates.kind === "annual" ? dates.startMonthDay : null,
    end_month_day: dates.kind === "annual" ? dates.endMonthDay : null,
    weekdays:
      weekdays === null
        ? null
        : weekdays.reduce((mask, day) => mask | (1 << day), 0),
    window_start_minute: window?.startMinute ?? null,
    window_end_minute: window?.endMinute ?? null,
  };
}

/** Reads a channel's rules, each with its sources, in saved rule order. */
export async function readRules(
  executor: Executor,
  channelId: string,
  ruleId?: string,
): Promise<SavedRule[]> {
  let query = executor
    .selectFrom("programming_rules")
    .selectAll()
    .where("channel_id", "=", channelId);
  if (ruleId !== undefined) query = query.where("id", "=", ruleId);
  const rows = await query.orderBy("rule_order").orderBy("id").execute();
  const rules: SavedRule[] = [];
  for (const row of rows) {
    const sources = await executor
      .selectFrom("programming_rule_sources")
      .selectAll()
      .where("rule_id", "=", row.id)
      .orderBy("position")
      .execute();
    rules.push({
      id: row.id,
      channelId: row.channel_id,
      name: row.name,
      behavior: row.behavior,
      priority: row.priority,
      ...toConditions(row),
      sources: sources.map(toSourceSettings),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  return rules;
}

/**
 * Loads a channel's rules as kraziPlan ranks and evaluates them, in saved
 * rule order. kraziPlan alone decides which applies and wins.
 */
export async function loadProgrammingRules(
  executor: Executor,
  channelId: string,
): Promise<ProgrammingRule[]> {
  const rules = await readRules(executor, channelId);
  return rules.map((rule, ruleOrder) => ({
    id: rule.id,
    behavior: rule.behavior,
    priority: rule.priority,
    ruleOrder,
    conditions: {
      dates: rule.dates,
      weekdays: rule.weekdays,
      window: rule.window,
    },
    sources: rule.sources.map(toRuleSource),
  }));
}

/** Flattens one rule source's settings into its row's setting columns. */
export function toSourceColumns(source: RuleSourceSettings) {
  const ordinary =
    source.ordinaryStretch === null
      ? null
      : toStretchColumns(source.ordinaryStretch);
  const marathon =
    source.marathon.mode === "replace"
      ? toStretchColumns(source.marathon.stretch)
      : null;
  return {
    ordinary_kind: ordinary?.kind ?? null,
    ordinary_min: ordinary?.min ?? null,
    ordinary_max: ordinary?.max ?? null,
    marathon_mode: source.marathon.mode,
    marathon_kind: marathon?.kind ?? null,
    marathon_min: marathon?.min ?? null,
    marathon_max: marathon?.max ?? null,
  };
}

/**
 * Returns the first rule whose inherited stretch pair for an assignment
 * would become invalid with `stretches`, so an assignment edit is refused
 * naming it rather than coercing the rule's values.
 */
export async function findRuleStretchConflict(
  executor: Executor,
  assignmentId: string,
  stretches: { ordinary: StretchSetting; marathon: StretchSetting | null },
): Promise<RuleStretchConflict | undefined> {
  const rows = await executor
    .selectFrom("programming_rule_sources as source")
    .innerJoin("programming_rules as rule", "rule.id", "source.rule_id")
    .selectAll("source")
    .select("rule.name")
    .where("source.assignment_id", "=", assignmentId)
    .orderBy("rule.rule_order")
    .orderBy("rule.id")
    .execute();
  for (const row of rows) {
    const problem = findRuleSourceProblem(
      toRuleSource(toSourceSettings(row)),
      stretches,
    );
    if (problem !== null) {
      return {
        kind: "rule_stretch_conflict",
        ruleId: row.rule_id,
        ruleName: row.name,
        problem,
      };
    }
  }
  return undefined;
}

/** Reads a rule source row's settings; the table checks make any other shape corruption. */
function toSourceSettings(
  row: Selectable<ProgrammingRuleSourceTable>,
): RuleSourceSettings {
  const replacement =
    row.marathon_kind === null || row.marathon_min === null
      ? null
      : toStretch({
          kind: row.marathon_kind,
          min: row.marathon_min,
          max: row.marathon_max,
        });
  return {
    assignmentId: row.assignment_id,
    ordinaryStretch:
      row.ordinary_kind === null || row.ordinary_min === null
        ? null
        : toStretch({
            kind: row.ordinary_kind,
            min: row.ordinary_min,
            max: row.ordinary_max,
          }),
    marathon:
      row.marathon_mode === "replace" && replacement !== null
        ? { mode: "replace", stretch: replacement }
        : row.marathon_mode === "disabled"
          ? { mode: "disabled" }
          : { mode: "inherit" },
  };
}

/** Names a source's settings as kraziPlan reads them. */
export function toRuleSource(source: RuleSourceSettings): RuleSource {
  return {
    assignmentId: source.assignmentId,
    ordinary: source.ordinaryStretch,
    marathon: source.marathon,
  };
}

/** Reads a rule row's calendar conditions; the table checks make any other shape corruption. */
function toConditions(
  row: Selectable<ProgrammingRuleTable>,
): CalendarConditions {
  return {
    dates:
      row.date_kind === "one_off"
        ? {
            kind: "one_off",
            startDate: row.start_date ?? "",
            endDate: row.end_date ?? "",
          }
        : row.date_kind === "annual"
          ? {
              kind: "annual",
              startMonthDay: row.start_month_day ?? "",
              endMonthDay: row.end_month_day ?? "",
            }
          : { kind: "any" },
    weekdays:
      row.weekdays === null || row.weekdays === 0
        ? null
        : [0, 1, 2, 3, 4, 5, 6].filter(
            (day) => ((row.weekdays ?? 0) & (1 << day)) !== 0,
          ),
    window:
      row.window_start_minute === null || row.window_end_minute === null
        ? null
        : {
            startMinute: row.window_start_minute,
            endMinute: row.window_end_minute,
          },
  };
}
