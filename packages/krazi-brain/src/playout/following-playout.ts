import type {
  FollowingPlayout,
  PlayoutCursor,
  PlayoutEntry,
  PlayoutItem,
} from "./contracts.js";
import { findFillerAt, type FillerInputs } from "./filler.js";
import { itemStartingAt } from "./playout-item.js";

/**
 * Rejects a following count that is not a positive integer as a programming
 * error. Exported so callers can reject one before any query or coverage
 * write, and so SQLite never reads a negative LIMIT as no limit at all.
 */
export function assertFollowingCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error(`following count must be a positive integer: ${count}`);
  }
}

/**
 * Selects up to `count` playable items airing back to back after the
 * cursor, programs and planned filler alike, stopping at the first gap or
 * unplayable entry, because a worker can only transition into an item that
 * starts exactly when the previous one ends. Contiguity is judged by time,
 * never by sequence numbers, which regeneration never reuses.
 *
 * A program cursor is stale when its entry is gone; a filler cursor when no
 * filler ends at its instant any more (ADR 0014). `entries` must be in
 * start order and hold the cursor's entry, or the program before a filler
 * cursor, and the entries after it.
 */
export function selectFollowingPlayout({
  cursor,
  entries,
  count,
  ...filler
}: FillerInputs & {
  cursor: PlayoutCursor;
  entries: readonly PlayoutEntry[];
  count: number;
}): FollowingPlayout {
  assertFollowingCount(count);
  const base = {
    channelId: filler.channelId,
    scheduleRevision: filler.scheduleRevision,
  };
  const from = cursorEnd(cursor, entries, filler);
  if (from === undefined) {
    return { ...base, status: "stale_entry", items: [] };
  }

  const items: PlayoutItem[] = [];
  let endsAt = from;
  while (items.length < count) {
    const item = itemStartingAt(endsAt, entries, filler);
    if (item === null) break;
    items.push(item);
    endsAt = item.endsAt;
  }
  return { ...base, status: "selected", items };
}

/** Returns where the cursor's item ends, or undefined when it is stale. */
function cursorEnd(
  cursor: PlayoutCursor,
  entries: readonly PlayoutEntry[],
  filler: FillerInputs,
): number | undefined {
  if (cursor.kind === "program") {
    return entries.find((entry) => entry.id === cursor.scheduleEntryId)?.endsAt;
  }
  // A filler is at least a millisecond long, so its last instant names it.
  const airing = findFillerAt(cursor.endsAt - 1, entries, filler);
  return airing?.endsAt === cursor.endsAt ? cursor.endsAt : undefined;
}
