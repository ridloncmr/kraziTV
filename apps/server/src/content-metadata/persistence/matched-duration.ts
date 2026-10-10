import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";

/**
 * Takes a matched item's current probed duration as its match-time duration,
 * so a file the owner reviewed stops reading as changed since it was
 * matched. Only a still-matched decision changes, and an item with no probed
 * duration keeps the one it had, so a later probe can still flag a change.
 * Takes the caller's executor so it commits with the review that prompted it.
 */
export async function recordMatchedDuration(
  executor: Kysely<DatabaseSchema>,
  mediaItemId: string,
): Promise<void> {
  await executor
    .updateTable("metadata_matches")
    .set((eb) => ({
      matched_duration_ms: eb.fn.coalesce(
        eb
          .selectFrom("media_items")
          .select("media_items.duration_ms")
          .whereRef("media_items.id", "=", "metadata_matches.media_item_id"),
        "metadata_matches.matched_duration_ms",
      ),
    }))
    .where("media_item_id", "=", mediaItemId)
    .where("state", "=", "matched")
    .execute();
}
