import type {
  CollectionCriterion,
  MediaCollection,
} from "../http/contracts/collections.js";

/**
 * What a media collection is built from: members the owner picked, or the
 * kind of its collection criterion.
 */
export type CollectionType = "manual" | CollectionCriterion["kind"];

// Each type in the order filters list it, with the words every screen uses.
const LABELS: Record<CollectionType, string> = {
  manual: "Manual",
  series: "TV series",
  franchise: "Movie franchise",
  tag: "Tag",
  genre: "Genre",
};

/** Every collection type, in the order a filter lists them. */
export const COLLECTION_TYPES = Object.keys(LABELS) as CollectionType[];

/** Names a collection type in the words its filter, cards, and criterion picker use. */
export function collectionTypeLabel(type: CollectionType): string {
  return LABELS[type];
}

/**
 * A collection's type. One without a criterion matches on nothing, so it is
 * manual whatever its maintenance mode says.
 */
export function collectionTypeOf(collection: MediaCollection): CollectionType {
  return collection.criterion?.kind ?? "manual";
}

/** Whether a collection passes a type filter; a null filter passes every collection. */
export function hasCollectionType(
  collection: MediaCollection,
  type: CollectionType | null,
): boolean {
  return type === null || collectionTypeOf(collection) === type;
}
