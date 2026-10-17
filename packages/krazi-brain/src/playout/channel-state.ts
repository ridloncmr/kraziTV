import type { ChannelState, PlayoutEntry } from "./contracts.js";
import { findFillerAt, type FillerInputs } from "./filler.js";
import { itemStartingAt, toPlayoutItem } from "./playout-item.js";

/**
 * Derives what a channel transmits at `evaluatedAt` and the offset a viewer
 * joins at: the program airing, or planned filler, which reports itself
 * current like a program (ADR 0014). Never substitutes another program for
 * unplayable media, because that would disagree with the published
 * schedule; time neither covers is a schedule gap.
 *
 * `entries` must be in start order and hold the entry covering
 * `evaluatedAt`, or else the last one before it, and the entries starting
 * after it up to the next program.
 */
export function deriveChannelState({
  evaluatedAt,
  entries,
  ...filler
}: FillerInputs & {
  evaluatedAt: number;
  entries: readonly PlayoutEntry[];
}): ChannelState {
  const { channelId, scheduleRevision } = filler;
  const base = { channelId, scheduleRevision, evaluatedAt };
  const covering = entries.find(
    (entry) => entry.startsAt <= evaluatedAt && evaluatedAt < entry.endsAt,
  );
  if (covering === undefined) {
    const airing = findFillerAt(evaluatedAt, entries, filler);
    if (airing === undefined) {
      return {
        ...base,
        kind: "no_current",
        currentItem: null,
        nextItem: null,
        reason: "schedule_gap",
      };
    }
    return {
      ...base,
      kind: "current",
      currentItem: { ...airing, offsetMs: evaluatedAt - airing.startsAt },
      nextItem: itemStartingAt(airing.endsAt, entries, filler),
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
  return {
    ...base,
    kind: "current",
    currentItem: { ...item, offsetMs },
    nextItem: itemStartingAt(covering.endsAt, entries, filler),
  };
}
