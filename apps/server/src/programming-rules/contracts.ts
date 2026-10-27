import type {
  CalendarConditions,
  ProgrammingRule,
  RuleMarathon,
  StretchSetting,
} from "@krazitv/krazi-brain";

/** One assignment a rule selects, with the settings it applies while it is the first active rule naming it. */
export interface RuleSourceSettings {
  assignmentId: string;
  /** Replaces the assignment's ordinary stretch; null inherits it. */
  ordinaryStretch: StretchSetting | null;
  marathon: RuleMarathon;
}

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
  sources: RuleSourceSettings[];
}

/** A saved programming rule. */
export interface SavedRule extends RuleSettings {
  id: string;
  channelId: string;
  createdAt: number;
  updatedAt: number;
}

/** A source naming an assignment the channel does not have, or whose effective stretch pair is invalid. */
export type RuleSourceRefusal =
  | { kind: "unknown_assignment"; assignmentId: string }
  | { kind: "invalid_stretch"; assignmentId: string; problem: string };

/** A rule whose inherited stretch pair an assignment edit would make invalid. */
export interface RuleStretchConflict {
  kind: "rule_stretch_conflict";
  ruleId: string;
  ruleName: string;
  problem: string;
}

export type CreateRuleResult =
  | { kind: "created"; rule: SavedRule }
  | { kind: "channel_not_found" }
  | RuleSourceRefusal;

export type UpdateRuleResult =
  | { kind: "updated" | "unchanged"; rule: SavedRule }
  | { kind: "not_found" }
  | RuleSourceRefusal;

export type DeleteRuleResult = { kind: "deleted" } | { kind: "not_found" };

/** A reorder must name exactly the channel's rules, each once. */
export type ReorderRulesResult =
  | { kind: "reordered" | "unchanged"; rules: SavedRule[] }
  | { kind: "channel_not_found" }
  | { kind: "mismatch"; ruleIds: string[] };
