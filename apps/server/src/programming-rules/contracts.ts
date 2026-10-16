import type { CalendarConditions, ProgrammingRule } from "@krazitv/krazi-brain";

/**
 * What the owner saves for one programming rule; the API accepts and
 * returns it. Its calendar conditions combine with AND, each unset one
 * unrestricted, and are evaluated in the programming timezone.
 */
export interface RuleSettings extends CalendarConditions {
  name: string;
  behavior: ProgrammingRule["behavior"];
  /** Higher wins. */
  priority: number;
  /** The channel's assignments the rule selects, in saved source order. */
  sources: { assignmentId: string }[];
}

/** A saved programming rule. */
export interface SavedRule extends RuleSettings {
  id: string;
  channelId: string;
  createdAt: number;
  updatedAt: number;
}

/** A source naming an assignment the channel does not have. */
export interface UnknownAssignmentResult {
  kind: "unknown_assignment";
  assignmentId: string;
}

export type CreateRuleResult =
  | { kind: "created"; rule: SavedRule }
  | { kind: "channel_not_found" }
  | UnknownAssignmentResult;

export type UpdateRuleResult =
  | { kind: "updated" | "unchanged"; rule: SavedRule }
  | { kind: "not_found" }
  | UnknownAssignmentResult;

export type DeleteRuleResult = { kind: "deleted" } | { kind: "not_found" };

/** A reorder must name exactly the channel's rules, each once. */
export type ReorderRulesResult =
  | { kind: "reordered" | "unchanged"; rules: SavedRule[] }
  | { kind: "channel_not_found" }
  | { kind: "mismatch"; ruleIds: string[] };
