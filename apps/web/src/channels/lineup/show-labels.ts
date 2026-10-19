/**
 * Names a show by its members joined with `+`, naming two at most and
 * counting the rest, so a long member list keeps the lineup row short.
 */
export function joinShowNames(names: readonly string[]): string {
  const shown = names.slice(0, 2).join(" + ");
  return names.length > 2 ? `${shown} + ${names.length - 2} more` : shown;
}
