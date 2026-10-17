import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";

/**
 * Lists the channels whose programming plays a collection, through an
 * assignment or a reservation that has not ended by `now`, in ID order, so
 * a membership change regenerates each and a delete is refused while any
 * does. An ended reservation no longer counts. Takes any executor so a
 * caller such as collection delete can ask inside its own transaction.
 */
export async function findChannelsUsingCollection(
  executor: Kysely<DatabaseSchema>,
  mediaCollectionId: string,
  now: number,
): Promise<string[]> {
  const rows = await executor
    .selectFrom("programming_assignment_members")
    .select("channel_id")
    .where("media_collection_id", "=", mediaCollectionId)
    .union(
      executor
        .selectFrom("reservations")
        .select("channel_id")
        .where("media_collection_id", "=", mediaCollectionId)
        .where("ends_at", ">", now),
    )
    .orderBy("channel_id")
    .execute();
  return rows.map(({ channel_id }) => channel_id);
}
