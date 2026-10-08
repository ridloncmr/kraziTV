/**
 * Returns a copy of a checkbox grid's chosen IDs with `ids` chosen or
 * released. A copy, so React sees a new selection; choices outside `ids`,
 * such as rows a filter or another page hides, are kept.
 */
export function withIds(
  chosen: ReadonlySet<string>,
  ids: readonly string[],
  on: boolean,
): ReadonlySet<string> {
  const next = new Set(chosen);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}
