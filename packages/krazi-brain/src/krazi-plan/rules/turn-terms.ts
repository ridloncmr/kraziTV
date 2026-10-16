import type {
  ProgrammingAssignment,
  ProgrammingRule,
  StretchSetting,
} from "../contracts.js";
import { decideRule, ruleScope } from "./winning-rule.js";

/** What a started turn depends on: where it runs, whether it may, and the sizes it runs with. */
interface TurnTerms {
  contextKey: string;
  eligible: boolean;
  ordinary: StretchSetting | null;
  marathon: StretchSetting | null;
}

/**
 * Describes the terms a turn of `assignmentId` runs under at an instant
 * (programming spec 0005): the rotation context the winning rule puts it
 * in, whether its source is eligible there, and the effective stretch
 * settings it has. Comparing them before and after a rule edit tells
 * whether the edit changed anything the started turn depends on, so only
 * then does the edit end it.
 */
export function turnTerms(
  rules: readonly ProgrammingRule[],
  assignments: readonly ProgrammingAssignment[],
  instant: number,
  timeZone: string,
  assignmentId: string,
): TurnTerms {
  const { winner } = decideRule(rules, assignments, instant, timeZone);
  const scope = ruleScope(winner, assignments);
  const assignment = scope.eligible.find(({ id }) => id === assignmentId);
  return {
    contextKey: scope.contextKey,
    eligible: assignment !== undefined,
    ordinary: assignment?.ordinary ?? null,
    marathon: assignment?.marathon ?? null,
  };
}
