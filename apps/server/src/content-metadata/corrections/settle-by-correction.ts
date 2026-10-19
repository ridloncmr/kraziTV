import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { correctsAnyFact } from "../persistence/corrected-columns.js";
import { dropCandidates } from "../persistence/match-rows.js";

/**
 * Settles an item that needed a choice once the owner corrects a fact on it:
 * its candidates are dropped and it returns to unmatched, as expiry leaves
 * an item, with the correction as its answer. It then leaves Review matches
 * and, being corrected, is never looked up again by a scan; clearing every
 * correction lets the next scan look it up afresh. Tags alone settle
 * nothing, and an item in any other state is untouched. Runs inside the
 * caller's transaction, which holds write authority.
 */
export async function settleByCorrection(
  executor: Kysely<DatabaseSchema>,
  mediaItemId: string,
): Promise<void> {
  const corrected = await executor
    .selectFrom("metadata_corrections")
    .select("media_item_id")
    .where("media_item_id", "=", mediaItemId)
    .where(correctsAnyFact)
    .executeTakeFirst();
  if (corrected !== undefined) await dropCandidates(executor, [mediaItemId]);
}
