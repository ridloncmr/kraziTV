import type { RuleMarathon } from "@krazitv/krazi-brain";

import type { StretchKind } from "./programming-source-assignment-table.js";

/**
 * One assignment a rule selects, in saved source order, with the stretch
 * settings that apply only while the rule wins. Null ordinary columns
 * inherit the assignment's; marathon columns are set only to replace it.
 * Deleting the assignment deletes the reference.
 */
export interface ProgrammingRuleSourceTable {
  rule_id: string;
  channel_id: string;
  assignment_id: string;
  position: number;
  ordinary_kind: StretchKind | null;
  ordinary_min: number | null;
  ordinary_max: number | null;
  /** Whether the source keeps, turns off, or replaces its assignment's marathon. */
  marathon_mode: RuleMarathon["mode"];
  marathon_kind: StretchKind | null;
  marathon_min: number | null;
  marathon_max: number | null;
  created_at: number;
}
