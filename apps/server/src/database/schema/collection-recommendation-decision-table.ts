/**
 * The owner's decision on one collection recommendation, keyed by the
 * canonical JSON of its criterion. It outlives any collection acceptance
 * created, so deleting that collection never resurrects the recommendation.
 */
export interface CollectionRecommendationDecisionTable {
  criterion_key: string;
  decision: "accepted" | "dismissed";
  decided_at: number;
}
