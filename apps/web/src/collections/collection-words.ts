import { displayCount } from "../controls/display-count.js";
import { AVAILABILITY_LABELS } from "../media-availability/availability-label.js";
import type {
  CollectionStatus,
  MediaCollection,
} from "../http/contracts/collections.js";

/**
 * Says what a collection can air and why the rest cannot, from the status
 * the server counted: "12 of 14 can air (1 missing, 1 too short)". Only the
 * causes present are named, so a fully airable collection reads as a plain
 * count. A file's cause uses the availability word its row shows. An empty
 * manual collection points at the picker below; an empty automatic one has
 * nothing to add, since its criterion fills it.
 */
export function canAirWords(
  status: CollectionStatus,
  maintenanceMode: MediaCollection["maintenanceMode"],
): string {
  if (status.memberCount === 0) {
    return maintenanceMode === "manual"
      ? "Nothing to air yet, add media below."
      : "Nothing to air yet.";
  }
  const counts = `${displayCount(status.schedulableCount)} of ${displayCount(status.memberCount)} can air`;
  const causes = (
    [
      [status.missingCount, AVAILABILITY_LABELS.missing.toLowerCase()],
      [
        status.couldNotReadCount,
        AVAILABILITY_LABELS.probe_failed.toLowerCase(),
      ],
      [status.tooShortCount, "too short"],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, cause]) => `${displayCount(count)} ${cause}`);
  return causes.length === 0 ? counts : `${counts} (${causes.join(", ")})`;
}
