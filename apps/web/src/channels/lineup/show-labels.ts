import type {
  AssignmentMember,
  SourceAssignment,
} from "../../http/contracts/programming.js";

/**
 * Names a show by its members joined with `+`, naming two at most and
 * counting the rest, so a long member list keeps the lineup row short.
 */
export function joinShowNames(names: readonly string[]): string {
  return summarizeNames(names, " + ", " + ");
}

/**
 * Lists several shows or programs in one table cell, such as a rule's
 * shows, naming two at most and counting the rest.
 */
export function listNames(names: readonly string[]): string {
  return summarizeNames(names, ", ", " and ");
}

// Names two at most, joined by `separator`, then counts the rest after `last`.
function summarizeNames(
  names: readonly string[],
  separator: string,
  last: string,
): string {
  const shown = names.slice(0, 2).join(separator);
  return names.length > 2 ? `${shown}${last}${names.length - 2} more` : shown;
}

/** Names a show by the owner's name for it, else by its members' names. */
export function showLabel(
  name: string | null,
  memberNames: readonly string[],
): string {
  return name ?? joinShowNames(memberNames);
}

/**
 * Names an assignment's show as every screen that lists it does: the
 * owner's name for it, else its members' names as `memberName` reads them.
 */
export function assignmentShowLabel(
  assignment: Pick<SourceAssignment, "name" | "members">,
  memberName: (member: AssignmentMember) => string,
): string {
  return showLabel(assignment.name, assignment.members.map(memberName));
}
