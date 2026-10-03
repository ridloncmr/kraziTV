import type {
  FollowingPlayout,
  PlayoutEntry,
  PlayoutItem,
} from "./contracts.js";
import { toPlayoutItem } from "./playout-item.js";

/**
 * Selects up to `count` playable items airing back to back after the cursor
 * entry, stopping at the first gap or unplayable entry, because a worker can
 * only transition into an item that starts exactly when the previous one ends.
 *
 * `cursor` is undefined when the cursor entry no longer exists on the channel.
 * `candidates` are the entries after it in channel sequence order; contiguity
 * is judged by time, never by sequence numbers, which regeneration never reuses.
 */
export function selectFollowingPlayout({
  channelId,
  scheduleRevision,
  cursor,
  candidates,
  count,
}: {
  channelId: string;
  scheduleRevision: number;
  cursor: PlayoutEntry | undefined;
  candidates: readonly PlayoutEntry[];
  count: number;
}): FollowingPlayout {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error(`following count must be a positive integer: ${count}`);
  }
  const base = { channelId, scheduleRevision };
  if (!cursor) {
    return { ...base, status: "stale_entry", items: [] };
  }

  const items: PlayoutItem[] = [];
  let endsAt = cursor.endsAt;
  for (const candidate of candidates) {
    if (items.length === count || candidate.startsAt !== endsAt) {
      break;
    }
    const item = toPlayoutItem(candidate, channelId, scheduleRevision);
    if (!item) {
      break;
    }
    items.push(item);
    endsAt = item.endsAt;
  }
  return { ...base, status: "selected", items };
}
