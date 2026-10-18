import { displayTime } from "../../controls/display-time.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import { kindLabel } from "./criterion-picker.js";

/**
 * Names what an automatic collection matches on, as its card and editor
 * show it; null for a manual collection, which matches on nothing.
 */
export function criterionBasis(collection: MediaCollection): string | null {
  return collection.criterion === null
    ? null
    : `${kindLabel(collection.criterion.kind)}: ${collection.criterionLabel ?? ""}`;
}

/**
 * A card's one-line maintenance status. A failure or incomplete update is
 * said in words beside an icon, never by color alone; membership stays as
 * of the last successful update.
 */
export function CardMaintenanceStatus({
  collection,
}: {
  collection: MediaCollection;
}) {
  const warning =
    collection.maintenanceError !== null
      ? "Update failed — members may be out of date"
      : collection.maintenanceIncomplete === true
        ? "Incomplete — expired TMDB data kept members unchanged"
        : undefined;
  return warning === undefined ? (
    <span>Up to date</span>
  ) : (
    <span className="warning-label">
      <span role="img" aria-label="Warning">
        ⚠
      </span>{" "}
      {warning}
    </span>
  );
}

/**
 * The editor's maintenance report: when membership was last brought up to
 * date, why the latest update failed, or that expired TMDB data left part
 * of it unchecked.
 */
export function MaintenanceReport({
  collection,
}: {
  collection: MediaCollection;
}) {
  const since = displayTime(collection.maintainedAt);
  if (collection.maintenanceError !== null) {
    return (
      <p role="alert" className="error-message">
        Updating this collection failed: {collection.maintenanceError}. Its
        members are as of {since}.
      </p>
    );
  }
  return (
    <small className="secondary">
      Last updated {since}
      {collection.maintenanceIncomplete === true &&
        ". Some media's TMDB data expired, so their membership could not be checked; members stay and none are added until a refresh restores it"}
    </small>
  );
}
