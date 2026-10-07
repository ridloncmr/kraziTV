import type { MediaItem } from "../http/contracts.js";
import type { DraftMember } from "./contracts.js";

// Numeric collation orders "Episode 2" before "Episode 10"; a fixed locale keeps
// the order independent of the browser's settings.
const COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/**
 * Moves the chosen members as one block, keeping their relative order, so the
 * block starts at `index` among the members left behind. An index past the
 * end moves the block to the bottom.
 */
export function moveMembers(
  members: readonly DraftMember[],
  chosen: ReadonlySet<string>,
  index: number,
): DraftMember[] {
  const block = members.filter((item) => chosen.has(item.mediaItemId));
  const rest = members.filter((item) => !chosen.has(item.mediaItemId));
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/**
 * Sorts by path or title, with the other breaking ties. Path order usually
 * matches episode order, so it is the quick way to set a chronological order.
 */
export function sortMembers(
  members: readonly DraftMember[],
  key: "path" | "title",
): DraftMember[] {
  const other = key === "path" ? "title" : "path";
  return [...members].sort(
    (a, b) =>
      COLLATOR.compare(a[key], b[key]) || COLLATOR.compare(a[other], b[other]),
  );
}

/**
 * Appends catalog media that are not members yet. Additions go in path order
 * so a season added in one step airs in episode order, whatever order the
 * items were picked in.
 */
export function appendMedia(
  members: readonly DraftMember[],
  media: readonly MediaItem[],
): DraftMember[] {
  const present = new Set(members.map((item) => item.mediaItemId));
  const added = media
    .filter((item) => !present.has(item.id))
    .map(({ id, title, path, status, durationMs }) => ({
      mediaItemId: id,
      title,
      path,
      status,
      durationMs,
    }));
  return [...members, ...sortMembers(added, "path")];
}
