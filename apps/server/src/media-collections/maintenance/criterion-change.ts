import type { ScheduleInputChange } from "../../schedules/contracts.js";
import type { AutomaticEditResult, CollectionCriterion } from "../contracts.js";
import { criterionKey } from "../criteria/collection-criterion.js";
import { readMatchableItems } from "../criteria/matchable-items.js";
import {
  findAutomaticCollection,
  reconcileCollection,
} from "./reconcile-collection.js";

/**
 * Builds the schedule input change that gives an automatic collection a new
 * criterion, and a new name when one is given. The criterion and the
 * membership it yields commit together, so channels drawing from the
 * collection regenerate once. Exclusions stay. Membership is recomputed from
 * current evidence alone: a member whose TMDB data expired is not kept just
 * because it matched the old criterion, which is the rule previews follow.
 */
export function criterionChange(
  collectionId: string,
  criterion: CollectionCriterion,
  name: string | undefined,
): ScheduleInputChange<AutomaticEditResult> {
  return async (trx, now) => {
    const collection = await findAutomaticCollection(trx, collectionId);
    if ("kind" in collection) {
      return { value: collection, affectedChannelIds: [] };
    }
    const stored = criterionKey(criterion);
    await trx
      .updateTable("media_collections")
      .set({
        criterion: stored,
        updated_at: now,
        ...(name === undefined ? {} : { name }),
      })
      .where("id", "=", collectionId)
      .execute();
    return {
      value: { kind: "changed" },
      affectedChannelIds: await reconcileCollection(
        trx,
        { id: collectionId, criterion: stored },
        await readMatchableItems(trx),
        now,
        { keepUnknownMembers: false },
      ),
    };
  };
}
