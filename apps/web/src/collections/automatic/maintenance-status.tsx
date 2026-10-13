import { displayTime } from "../../controls/display-time.js";
import type { MediaCollection } from "../../http/contracts.js";

/**
 * A card's one-line maintenance status. A failure is said in words beside
 * an icon, never by color alone; membership stays as of the last success.
 */
export function CardMaintenanceStatus({
  collection,
}: {
  collection: MediaCollection;
}) {
  return collection.maintenanceError === null ? (
    <span>Up to date</span>
  ) : (
    <span className="warning-label">
      <span role="img" aria-label="Warning">
        ⚠
      </span>{" "}
      Update failed — members may be out of date
    </span>
  );
}

/**
 * The editor's maintenance report: when membership was last brought up to
 * date and, after a failure, why the latest update failed.
 */
export function MaintenanceReport({
  collection,
}: {
  collection: MediaCollection;
}) {
  const since = displayTime(collection.maintainedAt);
  return collection.maintenanceError === null ? (
    <small className="secondary">Last updated {since}</small>
  ) : (
    <p role="alert" className="error-message">
      Updating this collection failed: {collection.maintenanceError}. Its
      members are as of {since}.
    </p>
  );
}
