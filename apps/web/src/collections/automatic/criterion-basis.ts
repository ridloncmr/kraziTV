import type { MediaCollection } from "../../http/contracts.js";

const KIND_LABELS: Record<
  NonNullable<MediaCollection["criterion"]>["kind"],
  string
> = {
  series: "TV series",
};

/**
 * Names what an automatic collection matches on, as its card and editor
 * show it; null for a manual collection, which matches on nothing.
 */
export function criterionBasis(collection: MediaCollection): string | null {
  return collection.criterion === null
    ? null
    : `${KIND_LABELS[collection.criterion.kind]}: ${collection.criterionLabel ?? ""}`;
}
