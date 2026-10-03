import type { ChannelState, PlayoutEntry } from "./contracts.js";
import { toPlayoutItem } from "./playout-item.js";

/**
 * Derives what a channel transmits at `evaluatedAt` and the offset a viewer
 * joins at. Never substitutes another program for unplayable media, because
 * that would disagree with the published schedule.
 *
 * `entries` must be in channel sequence order; normally it holds only the
 * covering entry and its successor.
 */
export function deriveChannelState({
  channelId,
  scheduleRevision,
  evaluatedAt,
  entries,
}: {
  channelId: string;
  scheduleRevision: number;
  evaluatedAt: number;
  entries: readonly PlayoutEntry[];
}): ChannelState {
  const base = { channelId, scheduleRevision, evaluatedAt };
  const index = entries.findIndex(
    (entry) => entry.startsAt <= evaluatedAt && evaluatedAt < entry.endsAt,
  );
  const covering = entries[index];
  if (!covering) {
    return {
      ...base,
      kind: "no_current",
      currentItem: null,
      nextItem: null,
      reason: "schedule_gap",
    };
  }

  const mediaUnavailable: ChannelState = {
    ...base,
    kind: "no_current",
    currentItem: null,
    nextItem: null,
    reason: "media_unavailable",
    scheduleEntryId: covering.id,
  };
  const item = toPlayoutItem(covering, channelId, scheduleRevision);
  if (!item) {
    return mediaUnavailable;
  }
  // The offset is never clamped; media re-probed shorter than its airtime
  // leaves nothing to play once the offset reaches its duration.
  const offsetMs = evaluatedAt - item.startsAt + item.startOffsetMs;
  if (offsetMs >= item.durationMs) {
    return mediaUnavailable;
  }

  // Only a successor airing exactly when this item ends follows it.
  const successor = entries[index + 1];
  const nextItem =
    successor && successor.startsAt === covering.endsAt
      ? toPlayoutItem(successor, channelId, scheduleRevision)
      : null;
  return {
    ...base,
    kind: "current",
    currentItem: { ...item, offsetMs },
    nextItem,
  };
}
