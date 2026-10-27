import {
  appliesAt,
  nextApplicabilityChange,
} from "../../calendar/applicability.js";
import type {
  ProgrammingAssignment,
  ProgrammingRule,
  RotationScope,
  RuleSkip,
} from "../contracts.js";
import { isUsableAssignment } from "../rotation/rotation.js";
import { applyRuleSettings } from "./rule-settings.js";

/** Which rules are active at an instant, which applicable rules dropped out, and how long that holds. */
interface RuleDecision {
  /** In saved rule order, then ID; empty when default rotation programs the instant. */
  active: ProgrammingRule[];
  /** Applicable rules at or above the active priority whose sources could not take a turn. */
  passedOver: RuleSkip[];
  /** The earliest instant any rule's applicability may change. */
  validUntil: number;
}

/**
 * Chooses the rules that program an instant (programming spec 0009): the
 * applicable rules at the highest priority that has a rule with a usable
 * assignment. Rules at that priority play together, and a higher priority
 * takes over completely. Each rule is examined once, and lower priorities
 * are never examined, so a channel whose rules all fall through reaches
 * default rotation without searching again. Rules are evaluated only in the
 * programming timezone; the result holds until any rule's applicability may
 * change.
 */
export function decideRule(
  rules: readonly ProgrammingRule[],
  assignments: readonly ProgrammingAssignment[],
  instant: number,
  timeZone: string,
): RuleDecision {
  const usable = new Set(
    assignments.filter(isUsableAssignment).map(({ id }) => id),
  );
  const passedOver: RuleSkip[] = [];
  const active: ProgrammingRule[] = [];
  for (const rule of [...rules].sort(byPrecedence)) {
    if (rule.priority < (active[0]?.priority ?? rule.priority)) break;
    if (!appliesAt(rule.conditions, instant, timeZone)) continue;
    if (rule.sources.some(({ assignmentId }) => usable.has(assignmentId))) {
      active.push(rule);
      continue;
    }
    passedOver.push({
      ruleId: rule.id,
      reason: rule.sources.length === 0 ? "no_sources" : "no_usable_source",
    });
  }
  return {
    active,
    passedOver,
    validUntil: Math.min(
      ...rules.map((rule) =>
        nextApplicabilityChange(rule.conditions, instant, timeZone),
      ),
    ),
  };
}

/**
 * Resolves which assignments take turns under the active rules, each once
 * and in saved assignment order. With a feature rule active, every active
 * rule's sources take turns alone in a context named for the sorted feature
 * rule IDs, so a lone feature rule keeps `rule:<id>`. With only join rules
 * active, their sources join the defaults in the `default` context, so a
 * join rule never ends turns by starting or stopping. Each carries the
 * stretch settings it runs with, so marathon candidates and turn sizes
 * follow them.
 */
export function ruleScope(
  active: readonly ProgrammingRule[],
  assignments: readonly ProgrammingAssignment[],
): RotationScope {
  const selected = new Set(
    active.flatMap(({ sources }) =>
      sources.map(({ assignmentId }) => assignmentId),
    ),
  );
  const features = active
    .filter(({ behavior }) => behavior === "feature")
    .map(({ id }) => id)
    .sort();
  if (features.length > 0) {
    const eligible = assignments
      .filter(({ id }) => selected.has(id))
      .map((assignment) => applyRuleSettings(assignment, active));
    return {
      contextKey: `rule:${features.join("+")}`,
      eligible,
      ruleDriven: new Set(eligible.map(({ id }) => id)),
    };
  }
  const eligible = assignments
    .filter(
      ({ id, participation }) =>
        participation === "default" || selected.has(id),
    )
    .map((assignment) => applyRuleSettings(assignment, active));
  return {
    contextKey: "default",
    eligible,
    ruleDriven: new Set(
      eligible
        .filter(({ participation }) => participation !== "default")
        .map(({ id }) => id),
    ),
  };
}

/** Orders rules by descending priority, then saved rule order, then ID. */
function byPrecedence(a: ProgrammingRule, b: ProgrammingRule): number {
  return (
    b.priority - a.priority ||
    a.ruleOrder - b.ruleOrder ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
