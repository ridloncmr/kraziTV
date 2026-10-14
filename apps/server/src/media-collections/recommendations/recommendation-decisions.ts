import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import type {
  AcceptRecommendationResult,
  CollectionCriterion,
  RecommendationAcceptance,
} from "../contracts.js";
import { criterionKey } from "../criteria/collection-criterion.js";
import { matchMembership } from "../criteria/match-criterion.js";
import { readMatchableItems } from "../criteria/matchable-items.js";
import { insertCollection } from "../persistence/collection-rows.js";
import { isRecommended } from "./recommendations.js";

/**
 * Accepts a recommendation: checks no decision and no collection with its
 * criterion exists, revalidates it against the current catalog, creates
 * the collection, and records the acceptance with that collection, all in
 * one immediate transaction. A second acceptance, even a concurrent one,
 * then creates nothing. A manual snapshot saves today's members and is
 * never maintained.
 */
export async function acceptRecommendation(
  db: Kysely<DatabaseSchema>,
  sources: { id: string; now: number },
  acceptance: RecommendationAcceptance,
): Promise<AcceptRecommendationResult> {
  const { criterion, mode } = acceptance;
  const key = criterionKey(criterion);
  return runImmediateTransaction(db, async (pinned) => {
    const decided = await pinned
      .selectFrom("collection_recommendation_decisions")
      .select("decision")
      .where("criterion_key", "=", key)
      .executeTakeFirst();
    const existing = await pinned
      .selectFrom("media_collections")
      .select("id")
      .where("criterion", "=", key)
      .executeTakeFirst();
    if (decided !== undefined || existing !== undefined) {
      return { kind: "decided" };
    }
    const items = await readMatchableItems(pinned);
    const recommended = isRecommended(criterion, items);
    if (!recommended.recommended) return { kind: "unavailable" };
    const { members, incomplete } = matchMembership(criterion, items, [], []);
    const collection = await insertCollection(pinned, {
      id: sources.id,
      name: recommended.name,
      now: sources.now,
      memberIds: members.map((item) => item.id),
      ...(mode === "automatic" ? { automatic: { criterion, incomplete } } : {}),
    });
    await pinned
      .insertInto("collection_recommendation_decisions")
      .values({
        criterion_key: key,
        decision: "accepted",
        media_collection_id: collection.id,
        decided_at: sources.now,
      })
      .execute();
    return { kind: "created", collection };
  });
}

/**
 * Dismisses a recommendation, or with no decision restores it by clearing
 * whatever was decided, including an acceptance whose collection the owner
 * deleted. An acceptance whose collection still exists is left alone, so
 * it can never be offered or dismissed again. A dismissal holds through
 * every rescan until restored.
 */
export async function decideRecommendation(
  db: Kysely<DatabaseSchema>,
  criterion: CollectionCriterion,
  decision: "dismissed" | undefined,
  now: number,
): Promise<void> {
  const key = criterionKey(criterion);
  if (decision === undefined) {
    await db
      .deleteFrom("collection_recommendation_decisions")
      .where("criterion_key", "=", key)
      .where("media_collection_id", "is", null)
      .execute();
    return;
  }
  await db
    .insertInto("collection_recommendation_decisions")
    .values({ criterion_key: key, decision, decided_at: now })
    .onConflict((conflict) =>
      conflict
        .column("criterion_key")
        .doUpdateSet({ decision, decided_at: now })
        .where(
          "collection_recommendation_decisions.media_collection_id",
          "is",
          null,
        ),
    )
    .execute();
}
