import { findUnknownMediaItemIds } from "../../media-items/media-item-repository.js";
import type { ScheduleInputChange } from "../../schedules/contracts.js";
import type { ExclusionChangeResult } from "../contracts.js";
import { readMatchableItems } from "../criteria/matchable-items.js";
import {
  findAutomaticCollection,
  reconcileCollection,
} from "../maintenance/reconcile-collection.js";

/**
 * Builds the schedule input change that excludes an item from an automatic
 * collection, or restores it. The decision and the collection's reconciled
 * membership commit together, so the owner sees the result at once and
 * channels drawing from the collection regenerate once. A restore includes
 * the item only if it matches now. The collection is read in the same
 * transaction, so a deletion or conversion committed first wins.
 */
export function exclusionChange(
  collectionId: string,
  mediaItemId: string,
  excluded: boolean,
): ScheduleInputChange<ExclusionChangeResult> {
  return async (trx, now) => {
    const collection = await findAutomaticCollection(trx, collectionId);
    if ("kind" in collection) {
      return { value: collection, affectedChannelIds: [] };
    }
    if (excluded) {
      const unknown = await findUnknownMediaItemIds(trx, [mediaItemId]);
      if (unknown.length > 0) {
        return {
          value: { kind: "unknown_media_items", mediaItemIds: unknown },
          affectedChannelIds: [],
        };
      }
      await trx
        .insertInto("media_collection_exclusions")
        .values({
          media_collection_id: collectionId,
          media_item_id: mediaItemId,
          created_at: now,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    } else {
      await trx
        .deleteFrom("media_collection_exclusions")
        .where("media_collection_id", "=", collectionId)
        .where("media_item_id", "=", mediaItemId)
        .execute();
    }
    return {
      value: { kind: "changed" },
      affectedChannelIds: await reconcileCollection(
        trx,
        collection,
        await readMatchableItems(trx),
        now,
      ),
    };
  };
}
