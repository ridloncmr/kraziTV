import { fileName } from "../controls/file-name.js";
import type { MediaItem } from "../http/contracts/media.js";

/**
 * The owner's word for each media item status. The library's Availability
 * column, its Filter, the scan summary, the collection rows, and the
 * collection status strip all read it here, so `probe_failed` never reaches a
 * screen and the words cannot drift apart.
 */
export const AVAILABILITY_LABELS: Record<MediaItem["status"], string> = {
  available: "Available",
  missing: "Missing",
  probe_failed: "Could not be read",
};

/**
 * The line a list row shows under an item's title: its file name, led by its
 * availability only when it cannot be used, so the usual available row stays
 * short and the exception stands out. The full path belongs in Details or a
 * hover title, never in the row.
 */
export function fileNote(item: Pick<MediaItem, "status" | "path">): string {
  const name = fileName(item.path);
  return item.status === "available"
    ? name
    : `${AVAILABILITY_LABELS[item.status]} · ${name}`;
}
