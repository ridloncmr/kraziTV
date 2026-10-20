// Wire shapes of media collections, their members, and recommendations.
/** What an automatic collection matches on: one TMDB series or movie franchise, one tag, or one genre. */
export type CollectionCriterion =
  | { kind: "series" | "franchise"; tmdbId: number }
  | { kind: "tag"; tagId: string }
  | { kind: "genre"; name: string };
export interface MediaCollection {
  id: string;
  name: string;
  /** `automatic` collections keep their own membership; `manual` ones change only by edits. */
  maintenanceMode: "manual" | "automatic";
  criterion: CollectionCriterion | null;
  /** The criterion's basis as the server names it, such as the series name. */
  criterionLabel: string | null;
  /** When maintenance last brought membership up to date; null when manual. */
  maintainedAt: string | null;
  /** Why the latest maintenance failed; members are as of `maintainedAt`. */
  maintenanceError: string | null;
  /** True when the last update kept or skipped items whose TMDB data expired. */
  maintenanceIncomplete: boolean | null;
}
/** `GET /media-collections`: one listed collection with how many members it includes. */
export interface MediaCollectionSummary extends MediaCollection {
  memberCount: number;
  /** Members whose file is missing; they stay included but cannot air. */
  missingCount: number;
}
/** `GET /media-collections/tags`: one tag on cataloged items a criterion can name. */
export interface CatalogTag {
  tagId: string;
  name: string;
  itemCount: number;
}
/** `GET /media-collections/genres`: one accepted standard genre a criterion can name. */
export interface CatalogGenre {
  name: string;
  itemCount: number;
}
/** `GET /media-collections/series` or `/franchises`: one cataloged group a criterion can name. */
export interface CatalogGroup {
  tmdbId: number;
  name: string;
  itemCount: number;
}
export interface CollectionMember {
  mediaItemId: string;
  title: string;
  path: string;
  status: string;
  durationMs: number | null;
  position: number;
}
/** `GET /media-collections/:id/exclusions`: an item kept out, and whether it would match if restored. */
export interface ExcludedItem extends Omit<CollectionMember, "position"> {
  /** Null while expired TMDB data leaves whether it matches unknown. */
  qualifies: boolean | null;
}
/** `GET /media-collections/recommendations`: one suggested series or franchise collection. */
export interface Recommendation {
  criterion: { kind: "series" | "franchise"; tmdbId: number };
  name: string;
  reason: string;
  memberCount: number;
  members: CollectionMember[];
  /** Distinct numbered seasons a series has cataloged, specials left out; null for a franchise. */
  seasonCount: number | null;
  /** The manual collection an acceptance saved, if any; one an automatic collection maintains is never listed. */
  collectionId: string | null;
  decision: "accepted" | "dismissed" | null;
}
export interface CollectionStatus {
  schedulable: boolean;
  schedulableCount: number;
  memberCount: number;
}
