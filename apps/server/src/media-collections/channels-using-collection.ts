import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";

/**
 * Lists the channels whose programming block draws from a collection, in ID
 * order. Takes any executor so a caller such as collection delete can ask
 * inside its own transaction. Distinct so the answer survives multiple blocks
 * per channel.
 */
export async function findChannelsUsingCollection(
  executor: Kysely<DatabaseSchema>,
  mediaCollectionId: string,
): Promise<string[]> {
  const rows = await executor
    .selectFrom("programming_blocks")
    .select("channel_id")
    .distinct()
    .where("media_collection_id", "=", mediaCollectionId)
    .orderBy("channel_id")
    .execute();
  return rows.map(({ channel_id }) => channel_id);
}
