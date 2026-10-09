import type { ExpressionBuilder } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";

/**
 * True for a match decision a scan must leave alone: matched, ambiguous,
 * rejected, or an extra. Only a new, unmatched, or failed-lookup item is
 * looked up, so the scan's read and its commit's re-check share this rule.
 */
export function isSettledMatch(
  eb: ExpressionBuilder<DatabaseSchema, "metadata_matches">,
) {
  return eb.or([
    eb("metadata_matches.state", "!=", "unmatched"),
    eb("metadata_matches.extra", "=", 1),
  ]);
}
