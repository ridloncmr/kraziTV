/**
 * The owner's decision on one collection recommendation, keyed by the
 * canonical JSON of its criterion. It outlives any collection acceptance
 * created, so deleting that collection never resurrects the recommendation.
 */
export interface CollectionRecommendationDecisionTable {
  criterion_key: string;
  decision: "accepted" | "dismissed";
  /** The collection an acceptance created, null once deleted or for a dismissal. */
  media_collection_id: string | null;
  decided_at: number;
}
