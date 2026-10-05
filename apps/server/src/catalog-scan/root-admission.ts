/** Why a root may not receive a scan: it is gone or switched off. */
type RootRejection = { kind: "root_not_found" } | { kind: "root_disabled" };

/**
 * Returns the first reason a root may not be scanned, or the root itself.
 * Shared by the scanner, which checks before scanning, and the writer, which
 * re-checks inside its transaction, so both refuse a root for the same reasons.
 */
export function admitRoot<R extends { enabled: boolean }>(
  root: R | undefined,
): { kind: "admitted"; root: R } | RootRejection {
  if (root === undefined) return { kind: "root_not_found" };
  if (!root.enabled) return { kind: "root_disabled" };
  return { kind: "admitted", root };
}
