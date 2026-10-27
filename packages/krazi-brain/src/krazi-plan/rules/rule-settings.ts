import type {
  ProgrammingAssignment,
  ProgrammingRule,
  RuleSource,
  SettingOrigins,
  StretchSetting,
} from "../contracts.js";
import { findStretchProblem } from "../stretches/stretch-settings.js";

const FROM_ASSIGNMENT: SettingOrigins = Object.freeze({
  ordinary: "assignment",
  marathon: "assignment",
});

/**
 * Returns the assignment as the active rules run it (programming spec
 * 0009): the ordinary and marathon settings of the first active rule naming
 * it, or the assignment unchanged when none does. Settings are never merged
 * across rules, and playback mode and progress are never a rule's to change.
 */
export function applyRuleSettings(
  assignment: ProgrammingAssignment,
  active: readonly ProgrammingRule[],
): ProgrammingAssignment {
  const source = findSource(active, assignment.id);
  return source === undefined
    ? assignment
    : { ...assignment, ...effectiveStretches(source, assignment) };
}

/** Says where an assignment's settings come from while `active` rules are active. */
export function settingOrigins(
  active: readonly ProgrammingRule[],
  assignmentId: string,
): SettingOrigins {
  const source = findSource(active, assignmentId);
  if (source === undefined) return FROM_ASSIGNMENT;
  return {
    ordinary: source.ordinary === null ? "assignment" : "rule",
    marathon:
      source.marathon.mode === "inherit"
        ? "assignment"
        : source.marathon.mode === "disabled"
          ? "disabled"
          : "rule",
  };
}

/**
 * Returns why a rule source's effective ordinary and marathon pair is
 * invalid, or null when spec 0004's stretch rule accepts it. Checked when a
 * rule is saved and when an assignment it inherits from changes, so values
 * are never coerced.
 */
export function findRuleSourceProblem(
  source: RuleSource,
  assignment: Pick<ProgrammingAssignment, "ordinary" | "marathon">,
): string | null {
  const { ordinary, marathon } = effectiveStretches(source, assignment);
  return findStretchProblem(ordinary, marathon);
}

/** The ordinary and marathon stretches a source runs with, from its rule or its assignment. */
function effectiveStretches(
  source: RuleSource,
  assignment: Pick<ProgrammingAssignment, "ordinary" | "marathon">,
): { ordinary: StretchSetting; marathon: StretchSetting | null } {
  return {
    ordinary: source.ordinary ?? assignment.ordinary,
    marathon:
      source.marathon.mode === "inherit"
        ? assignment.marathon
        : source.marathon.mode === "disabled"
          ? null
          : source.marathon.stretch,
  };
}

/**
 * The first active rule, in the saved rule order `active` is already in,
 * that names an assignment. It alone supplies the assignment's settings and
 * is recorded as the rule that chose its turn.
 */
export function findNamingRule(
  active: readonly ProgrammingRule[],
  assignmentId: string,
): ProgrammingRule | undefined {
  return active.find(({ sources }) =>
    sources.some((source) => source.assignmentId === assignmentId),
  );
}

/** The naming rule's reference to an assignment, if any active rule names it. */
function findSource(
  active: readonly ProgrammingRule[],
  assignmentId: string,
): RuleSource | undefined {
  return findNamingRule(active, assignmentId)?.sources.find(
    (source) => source.assignmentId === assignmentId,
  );
}
