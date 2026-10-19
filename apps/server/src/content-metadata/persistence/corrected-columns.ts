import type { ExpressionBuilder } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";

/**
 * The `metadata_corrections` columns that correct a content fact. An item
 * with any of them set counts as corrected, which settles it for scans; tags
 * are the owner's own facts, not a correction, so they are left out.
 */
export const CORRECTED_COLUMNS = [
  "title",
  "series_name",
  "season_number",
  "episode_number",
  "release_date",
] as const;

/** True for a `metadata_corrections` row that corrects at least one fact. */
export function correctsAnyFact(
  eb: ExpressionBuilder<DatabaseSchema, "metadata_corrections">,
) {
  return eb.or(
    CORRECTED_COLUMNS.map((column) =>
      eb(`metadata_corrections.${column}`, "is not", null),
    ),
  );
}
