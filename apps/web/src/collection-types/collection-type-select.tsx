import { displayCount } from "../controls/formatting/display-count.js";
import type { MediaCollection } from "../http/contracts/collections.js";
import {
  COLLECTION_TYPES,
  type CollectionType,
  collectionTypeLabel,
  collectionTypeOf,
} from "./collection-type.js";

// The select's value for no filter, since an option's value is a string.
const ALL = "";

/**
 * Narrows a list of collections to one collection type. It offers only the
 * types `collections` holds, each with its count, so no choice leads to an
 * empty list, and keeps a chosen type listed after its last collection
 * goes. With fewer than two types to choose between it shows nothing.
 */
export function CollectionTypeSelect({
  collections,
  value,
  onChange,
}: {
  collections: readonly MediaCollection[];
  value: CollectionType | null;
  onChange: (type: CollectionType | null) => void;
}) {
  const counts = new Map<CollectionType, number>();
  for (const collection of collections) {
    const type = collectionTypeOf(collection);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const offered = COLLECTION_TYPES.filter(
    (type) => counts.has(type) || type === value,
  );
  if (offered.length < 2 && value === null) return null;
  return (
    <label>
      Collection type
      <select
        value={value ?? ALL}
        onChange={(event) =>
          onChange(
            event.target.value === ALL
              ? null
              : (event.target.value as CollectionType),
          )
        }
      >
        <option value={ALL}>All types</option>
        {offered.map((type) => (
          <option key={type} value={type}>
            {`${collectionTypeLabel(type)} (${displayCount(counts.get(type) ?? 0)})`}
          </option>
        ))}
      </select>
    </label>
  );
}
