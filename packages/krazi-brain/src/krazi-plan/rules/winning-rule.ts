import {
  appliesAt,
  nextApplicabilityChange,
} from "../../calendar/applicability.js";
import type {
  ProgrammingAssignment,
  ProgrammingRule,
  RotationScope,
} from "../contracts.js";
import { isUsableAssignment } from "../rotation/rotation.js";

/** Which rule won at an instant, which applicable rules it passed over, and how long that holds. */
interface RuleDecision {
  /** Undefined when default rotation programs the instant. */
  winner: ProgrammingRule | undefined;
  /** Applicable rules ranked above the winner whose sources could not take a turn. */
  passedOver: string[];
  /** The earliest instant any rule's applicability may change. */
  validUntil: number;
}

/**
 * Chooses the rule that programs an instant (programming spec 0005): the
 * applicable rules in descending priority, then saved rule order, then ID,
 * and the first with a usable assignment wins. Each rule is examined once,
 * so a channel whose rules all fall through reaches default rotation
 * without searching again. Rules are evaluated only in the programming
 * timezone; the result holds until any rule's applicability may change.
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
  const passedOver: string[] = [];
  let winner: ProgrammingRule | undefined;
  for (const rule of [...rules].sort(byPrecedence)) {
    if (!appliesAt(rule.conditions, instant, timeZone)) continue;
    if (rule.sources.some(({ assignmentId }) => usable.has(assignmentId))) {
      winner = rule;
      break;
    }
    passedOver.push(rule.id);
  }
  return {
    winner,
    passedOver,
    validUntil: Math.min(
      ...rules.map((rule) =>
        nextApplicabilityChange(rule.conditions, instant, timeZone),
      ),
    ),
  };
}

/**
 * Resolves which assignments take turns under a winning rule: default
 * assignments with no winner; defaults plus a join rule's sources, each
 * once; or only a feature rule's sources, in that rule's own context.
 */
export function ruleScope(
  winner: ProgrammingRule | undefined,
  assignments: readonly ProgrammingAssignment[],
): RotationScope {
  const selected = new Set(
    winner?.sources.map(({ assignmentId }) => assignmentId) ?? [],
  );
  if (winner?.behavior === "feature") {
    const eligible = assignments.filter(({ id }) => selected.has(id));
    return {
      contextKey: `rule:${winner.id}`,
      eligible,
      ruleDriven: new Set(eligible.map(({ id }) => id)),
    };
  }
  const eligible = assignments.filter(
    ({ id, participation }) => participation === "default" || selected.has(id),
  );
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
