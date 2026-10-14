import type { Selectable } from "kysely";

import type { MediaCollectionTable } from "../database/schema/media-collection-table.js";
import type { MediaItemStatus } from "../database/schema/media-item-table.js";
import type {
  ContentIdentity,
  ContentMetadata,
} from "../media-items/contracts.js";

/**
 * What an automatic collection matches on. `criteria/collection-criterion.ts`
 * validates it for request bodies and stored rows alike.
 */
export type CollectionCriterion =
  | { kind: "series"; tmdbId: number }
  | { kind: "franchise"; tmdbId: number }
  | { kind: "tag"; tagId: string }
  | { kind: "genre"; name: string };

/** The criterion kinds that match a TMDB series or franchise identity. */
export type TmdbKind = Extract<CollectionCriterion, { tmdbId: number }>["kind"];

/** One TMDB series or franchise with cataloged items, as a criterion picker lists it. */
export interface CatalogGroup {
  tmdbId: number;
  name: string;
  /** How many items a collection for this series or franchise would include. */
  itemCount: number;
}

/** One of the owner's tags on cataloged items, as the tag picker lists it. */
export interface CatalogTag {
  tagId: string;
  name: string;
  /** How many items a collection for this tag would include. */
  itemCount: number;
}

/** One accepted standard genre on cataloged items, as the genre picker lists it. */
export interface CatalogGenre {
  name: string;
  /** How many items a collection for this genre would include. */
  itemCount: number;
}

/**
 * A suggested series or franchise collection: why it was suggested, the
 * members it would hold in order, any collection already made with its
 * criterion, and the owner's decision on it.
 */
export interface Recommendation {
  criterion: Extract<CollectionCriterion, { tmdbId: number }>;
  name: string;
  reason: string;
  members: MediaCollectionMember[];
  collectionId: string | null;
  decision: "accepted" | "dismissed" | null;
}

/** The owner's acceptance of one recommendation, as an automatic or manual collection. */
export interface RecommendationAcceptance {
  criterion: Extract<CollectionCriterion, { tmdbId: number }>;
  mode: "automatic" | "manual";
}

/**
 * `decided` refuses a second acceptance, one after a dismissal, or one
 * whose criterion a collection already has;
 * `unavailable` refuses a recommendation the catalog no longer supports.
 */
export type AcceptRecommendationResult =
  | { kind: "created"; collection: MediaCollection }
  | { kind: "decided" }
  | { kind: "unavailable" };

/** Whether a collection keeps its membership from a criterion or only by user edits. */
type MaintenanceMode = Selectable<MediaCollectionTable>["maintenance_mode"];

export interface MediaCollection {
  id: string;
  name: string;
  maintenanceMode: MaintenanceMode;
  /** What an automatic collection matches on; null for a manual one. */
  criterion: CollectionCriterion | null;
  /** The criterion's basis named for display, such as the series name. */
  criterionLabel: string | null;
  /** When maintenance last brought membership up to date; null for a manual collection. */
  maintainedAt: number | null;
  /** Why the latest maintenance failed; membership is as of `maintainedAt`. */
  maintenanceError: string | null;
  /** Whether the last pass kept or skipped items whose TMDB data expired; null when manual. */
  maintenanceIncomplete: boolean | null;
  createdAt: number;
  updatedAt: number;
}

/** A listed collection with how many members it includes, so a grid needs no per-card read. */
export interface MediaCollectionSummary extends MediaCollection {
  memberCount: number;
  /** Members whose file is missing; they stay included but cannot air until it returns. */
  missingCount: number;
}

/**
 * One cataloged item as criteria see it: the member summary a collection
 * shows, plus the effective facts and identities matching reads.
 */
export interface MatchableItem {
  id: string;
  title: string;
  path: string;
  status: MediaItemStatus;
  durationMs: number | null;
  metadata: ContentMetadata;
  identity: ContentIdentity;
}

/** One membership with the item summary needed to judge whether it is schedulable. */
export interface MediaCollectionMember {
  position: number;
  mediaItemId: string;
  title: string;
  path: string;
  status: MediaItemStatus;
  durationMs: number | null;
}

type UnknownMediaItemsResult = {
  kind: "unknown_media_items";
  mediaItemIds: string[];
};

export type CreateMediaCollectionResult =
  { kind: "created"; collection: MediaCollection } | UnknownMediaItemsResult;

/** `automatic` refuses a user's replacement: only maintenance writes that membership. */
export type ReplaceMediaCollectionMembersResult =
  | { kind: "replaced"; members: MediaCollectionMember[] }
  | { kind: "not_found" }
  | { kind: "automatic" }
  | UnknownMediaItemsResult;

/** An item the owner keeps out of an automatic collection, and whether it would match if restored. */
export interface ExcludedItem extends Omit<MediaCollectionMember, "position"> {
  /** Null while expired TMDB data leaves whether it matches unknown. */
  qualifies: boolean | null;
}

/** `manual` refuses: only an automatic collection has a criterion and exclusions. */
export type AutomaticEditResult =
  { kind: "changed" } | { kind: "not_found" } | { kind: "manual" };

export type ExclusionChangeResult =
  AutomaticEditResult | UnknownMediaItemsResult;

/** `in_use` names every channel whose programming block still draws from the collection. */
export type DeleteMediaCollectionResult =
  | { kind: "deleted" }
  | { kind: "not_found" }
  | { kind: "in_use"; channelIds: string[] };
