import type {
  ChannelState,
  FillerPlayoutItem,
  PlayoutEntry,
} from "./contracts.js";
import { cutAtReservations } from "./cuts.js";
import { findFillerAt, type FillerInputs } from "./filler.js";
import { itemStartingAt, toPlayoutItem } from "./playout-item.js";

/** What holds the airtime at one instant: a program, or planned filler. */
export type AiringSpan =
  | {
      kind: "program";
      scheduleEntryId: string;
      startsAt: number;
      endsAt: number;
    }
  | { kind: "filler"; startsAt: number; endsAt: number };

/**
 * Finds what holds the airtime at `at`, with its cut (ADR 0015): the program
 * whose entry covers it, playable or not, because an unplayable entry still
 * owns its airtime, or planned filler. Undefined in an unexplained gap. The
 * regeneration boundary and transition revalidation read this, so neither
 * ever mistakes a cut entry's stored end for its airtime.
 *
 * `entries` must be in start order and hold the entry covering `at`, or
 * else the last one before it, and the entries starting after it up to the
 * next program.
 */
export function findAiringAt({
  at,
  entries,
  ...filler
}: FillerInputs & {
  at: number;
  entries: readonly PlayoutEntry[];
}): AiringSpan | undefined {
  const airing = findAiring(
    at,
    cutAtReservations(entries, filler.reservations),
    filler,
  );
  if (airing === undefined) return undefined;
  if ("type" in airing) {
    return { kind: "filler", startsAt: airing.startsAt, endsAt: airing.endsAt };
  }
  return {
    kind: "program",
    scheduleEntryId: airing.id,
    startsAt: airing.startsAt,
    endsAt: airing.endsAt,
  };
}

/**
 * Derives what a channel transmits at `evaluatedAt` and the offset a viewer
 * joins at: the program airing, or planned filler, which reports itself
 * current like a program (ADR 0014). Never substitutes another program for
 * unplayable media, because that would disagree with the published
 * schedule; time neither covers is a schedule gap.
 *
 * `entries` must be in start order and hold the entry covering
 * `evaluatedAt`, or else the last one before it, and the entries starting
 * after it up to the next program. They are read with their cuts.
 */
export function deriveChannelState({
  evaluatedAt,
  entries: stored,
  ...filler
}: FillerInputs & {
  evaluatedAt: number;
  entries: readonly PlayoutEntry[];
}): ChannelState {
  const entries = cutAtReservations(stored, filler.reservations);
  const { channelId, scheduleRevision } = filler;
  const base = { channelId, scheduleRevision, evaluatedAt };
  const airing = findAiring(evaluatedAt, entries, filler);
  if (airing === undefined) {
    return {
      ...base,
      kind: "no_current",
      currentItem: null,
      nextItem: null,
      reason: "schedule_gap",
    };
  }
  if ("type" in airing) {
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
    scheduleEntryId: airing.id,
  };
  const item = toPlayoutItem(airing, channelId, scheduleRevision);
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
    nextItem: itemStartingAt(airing.endsAt, entries, filler),
  };
}

/**
 * Returns the cut entry covering `at`, else the planned filler airing then:
 * the one lookup both channel state and airing spans share.
 */
function findAiring(
  at: number,
  entries: readonly PlayoutEntry[],
  filler: FillerInputs,
): PlayoutEntry | FillerPlayoutItem | undefined {
  return (
    entries.find((entry) => entry.startsAt <= at && at < entry.endsAt) ??
    findFillerAt(at, entries, filler)
  );
}
