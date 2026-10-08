import { ApiError } from "../../http/api-error.js";
import type {
  CatalogRemoval,
  CatalogRemovalImpact,
  CatalogRemovalTarget,
  MediaRoot,
} from "../../http/contracts.js";

/** What a removal dialog removes; transient desktop shell state. */
export type RemovalSubject =
  { kind: "root"; root: MediaRoot } | { kind: "items"; mediaItemIds: string[] };

// Fixed locale, so counts read like the spec's messages everywhere.
const COUNT = new Intl.NumberFormat("en-US");

/** The API target for a subject. */
export function toTarget(subject: RemovalSubject): CatalogRemovalTarget {
  return subject.kind === "root"
    ? { mediaRootId: subject.root.id }
    : { mediaItemIds: subject.mediaItemIds };
}

/** States what goes: the root's path and item count, or the selected count. */
export function subjectSummary(
  subject: RemovalSubject,
  itemCount: number,
): string {
  return subject.kind === "root"
    ? `${subject.root.path} and its ${mediaItems(itemCount)} will be deleted from the catalog.`
    : `${COUNT.format(itemCount)} selected ${itemCount === 1 ? "media item" : "media items"} will be deleted from the catalog.`;
}

// The refusals the server can answer a preview or removal with.
const REFUSALS = new Set([
  "scan_in_progress",
  "media_item_not_found",
  "media_root_not_found",
  "media_item_in_use",
]);

/** Whether an error is a refusal, which replaces the dialog's preview. */
export function isRefusal(error: Error | undefined): boolean {
  return error instanceof ApiError && REFUSALS.has(error.code);
}

/**
 * Words a refusal the way the spec's table does, or returns undefined for an
 * error that is not a refusal, such as a lost connection. `channelNumber`
 * names a channel the server identified only by ID.
 */
export function refusalMessage(
  error: Error | undefined,
  channelNumber: (channelId: string) => string,
): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  switch (error.code) {
    case "scan_in_progress":
      return "This media root is being scanned. Cancel the scan or wait for it to finish.";
    case "media_item_not_found":
    case "media_root_not_found":
      return "Some of the selected media is no longer in the catalog. Refresh and try again.";
    case "media_item_in_use": {
      const ids = error.details.channelIds;
      const numbers = (Array.isArray(ids) ? ids : []).map((id) =>
        channelNumber(String(id)),
      );
      return numbers.length === 1
        ? `Channel ${numbers[0]} plays an item from this media root directly. Change that block first.`
        : `Channels ${numbers.join(", ")} play an item from this media root directly. Change those blocks first.`;
    }
    default:
      return undefined;
  }
}

/** Says when an unschedulable channel goes off air under the airing choice. */
export function offAirLine(channelNumber: string, rightAway: boolean): string {
  return rightAway
    ? `Channel ${channelNumber} goes off air right away.`
    : `Channel ${channelNumber} goes off air after its current program.`;
}

/**
 * Reports a committed removal: what went, then each airing channel's fate.
 * Channel numbers come from the impact the user confirmed, since the result
 * names channels by ID.
 */
export function removalFeedback(
  subject: RemovalSubject,
  result: CatalogRemoval,
  impact: CatalogRemovalImpact,
): string {
  const numberOf = (id: string) =>
    impact.airing.find((entry) => entry.channelId === id)?.channelNumber ?? id;
  const failed = new Set(result.stopFailedChannelIds);
  return [
    subject.kind === "root"
      ? `Deleted ${subject.root.path} and ${mediaItems(result.removedItemCount)}.`
      : `Deleted ${mediaItems(result.removedItemCount)}.`,
    ...result.finishing.map(
      ({ channelId }) =>
        `Channel ${numberOf(channelId)} finishes its current program first.`,
    ),
    ...result.interruptedChannelIds.map((id) =>
      failed.has(id)
        ? `Channel ${numberOf(id)} could not be stopped; it switches at the end of its current program.`
        : `Channel ${numberOf(id)} restarted on its new schedule.`,
    ),
  ].join(" ");
}

// Counts media items with the spec's grouping and plural.
function mediaItems(count: number): string {
  return `${COUNT.format(count)} media ${count === 1 ? "item" : "items"}`;
}
