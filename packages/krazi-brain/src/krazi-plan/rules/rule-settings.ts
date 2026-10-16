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
 * Returns the assignment as the winning rule runs it (programming spec
 * 0005): the rule's ordinary and marathon settings for a source it names,
 * or the assignment unchanged when no rule wins or the winner does not name
 * it. Playback mode and progress are never the rule's to change.
 */
export function applyRuleSettings(
  assignment: ProgrammingAssignment,
  winner: ProgrammingRule | undefined,
): ProgrammingAssignment {
  const source = findSource(winner, assignment.id);
  return source === undefined
    ? assignment
    : { ...assignment, ...effectiveStretches(source, assignment) };
}

/** Says where an assignment's settings come from while `winner` wins. */
export function settingOrigins(
  winner: ProgrammingRule | undefined,
  assignmentId: string,
): SettingOrigins {
  const source = findSource(winner, assignmentId);
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

/** The winner's reference to an assignment, if it has one. */
function findSource(
  winner: ProgrammingRule | undefined,
  assignmentId: string,
): RuleSource | undefined {
  return winner?.sources.find((source) => source.assignmentId === assignmentId);
}
