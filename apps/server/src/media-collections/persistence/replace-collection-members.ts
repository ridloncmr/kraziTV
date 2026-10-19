import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { findUnknownMediaItemIds } from "../../media-items/media-item-repository.js";
import type { ScheduleInputChange } from "../../schedules/contracts.js";
import { findChannelsUsingCollection } from "./channels-using-collection.js";
import type { ReplaceMediaCollectionMembersResult } from "../contracts.js";
import {
  collectionExists,
  insertMembers,
  selectMembers,
} from "./collection-rows.js";

/**
 * Replaces a collection's full membership in request order. Opens no
 * transaction: membership is a scheduling input, so it runs inside a schedule
 * input change whose regeneration must commit with it, at that change's
 * effective time. Item existence is checked against the same executor, and
 * the foreign key remains the final guard. Duplicate IDs throw, so the
 * caller's transaction rolls back.
 */
export async function replaceCollectionMembers(
  trx: Kysely<DatabaseSchema>,
  id: string,
  mediaItemIds: readonly string[],
  now: number,
): Promise<ReplaceMediaCollectionMembersResult> {
  if (!(await collectionExists(trx, id))) {
    return { kind: "not_found" };
  }
  const unknown = await findUnknownMediaItemIds(trx, mediaItemIds);
  if (unknown.length > 0) {
    return { kind: "unknown_media_items", mediaItemIds: unknown };
  }

  await trx
    .updateTable("media_collections")
    .set({ updated_at: now })
    .where("id", "=", id)
    .execute();
  await trx
    .deleteFrom("media_collection_items")
    .where("media_collection_id", "=", id)
    .execute();
  await insertMembers(trx, id, mediaItemIds, now);
  return { kind: "replaced", members: await selectMembers(trx, id) };
}

/**
 * Builds the schedule input change for a user's membership replacement: it
 * writes the new membership and names every channel drawing from the
 * collection, so each regenerates in the same transaction. An automatic
 * collection is refused, read in the same transaction as the write, since
 * only maintenance may write its membership. A rejected replacement affects
 * no channel.
 */
export function membershipChange(
  id: string,
  mediaItemIds: readonly string[],
): ScheduleInputChange<ReplaceMediaCollectionMembersResult> {
  return async (trx, now) => {
    const value = (await isAutomatic(trx, id))
      ? ({ kind: "automatic" } as const)
      : await replaceCollectionMembers(trx, id, mediaItemIds, now);
    return {
      value,
      affectedChannelIds:
        value.kind === "replaced"
          ? await findChannelsUsingCollection(trx, id, now)
          : [],
    };
  };
}

// Whether the collection exists and keeps its membership from a criterion.
async function isAutomatic(
  trx: Kysely<DatabaseSchema>,
  id: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom("media_collections")
    .select("maintenance_mode")
    .where("id", "=", id)
    .executeTakeFirst();
  return row?.maintenance_mode === "automatic";
}
