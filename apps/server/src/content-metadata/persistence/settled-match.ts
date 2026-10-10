import type { ExpressionBuilder } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { CORRECTED_COLUMNS } from "./corrected-columns.js";

/**
 * True for an item a scan must leave alone: one whose decision is matched,
 * ambiguous, rejected, or an extra, or one whose facts the owner corrected.
 * Only a new, unmatched, or failed-lookup item without corrections is looked
 * up, so the scan's read and its commit's re-check share this rule. Reads
 * `media_items` with `metadata_matches` left-joined, so an item corrected
 * before any lookup counts too. Tags alone are not a correction.
 */
export function isSettledMatch(
  eb: ExpressionBuilder<DatabaseSchema, "media_items" | "metadata_matches">,
) {
  return eb.or([
    eb("metadata_matches.state", "!=", "unmatched"),
    eb("metadata_matches.extra", "=", 1),
    eb.exists(
      eb
        .selectFrom("metadata_corrections")
        .select("metadata_corrections.media_item_id")
        .whereRef("metadata_corrections.media_item_id", "=", "media_items.id")
        .where((corrections) =>
          corrections.or(
            CORRECTED_COLUMNS.map((column) =>
              corrections(`metadata_corrections.${column}`, "is not", null),
            ),
          ),
        ),
    ),
  ]);
}
