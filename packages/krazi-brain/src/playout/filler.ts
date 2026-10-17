import type {
  FillerPlayoutItem,
  PlayoutEntry,
  ReservedTimeRange,
} from "./contracts.js";
import { cutAtReservations } from "./cuts.js";

/** What every playout read derives filler from, read in one snapshot. */
export interface FillerInputs {
  channelId: string;
  scheduleRevision: number;
  /** The channel's reservations, in any order and never overlapping. */
  reservations: readonly ReservedTimeRange[];
  /** Where a filler with no earlier program starts: the schedule anchor. */
  anchorTime: number;
}

/**
 * Finds the planned filler airing at `at` (ADR 0014), the one rule every
 * playout read uses. Filler covers time no entry covers that a reservation
 * explains: before its first program, after its last program up to its
 * end, or the whole range when none fits. It runs from the end of the last
 * program before it, or the schedule anchor, to the next program's start,
 * merged across reservations the gap reaches, or to the last such
 * reservation's end when no program follows yet. Any other uncovered
 * instant, such as a hole between two of a reservation's programs, is an
 * unexplained gap.
 *
 * `entries` must hold, in start order, any entry covering `at`, the
 * latest entry ending at or before `at`, and the earliest entry starting
 * after `at`, however far away; others may be present.
 */
export function findFillerAt(
  at: number,
  entries: readonly Pick<PlayoutEntry, "startsAt" | "endsAt">[],
  { channelId, scheduleRevision, reservations, anchorTime }: FillerInputs,
): FillerPlayoutItem | undefined {
  if (entries.some((entry) => entry.startsAt <= at && at < entry.endsAt)) {
    return undefined;
  }
  const previousEnd = entries.reduce<number | undefined>(
    (latest, entry) =>
      entry.endsAt <= at && (latest === undefined || entry.endsAt > latest)
        ? entry.endsAt
        : latest,
    undefined,
  );
  const startsAt = previousEnd ?? anchorTime;
  const nextStart =
    entries.find((entry) => entry.startsAt > at)?.startsAt ?? Infinity;
  const ranges = [...reservations]
    .filter((range) => range.endsAt > at)
    .sort((a, b) => a.startsAt - b.startsAt);
  const [first, ...later] = ranges;
  if (first === undefined || at < startsAt || nextStart < first.startsAt) {
    return undefined;
  }
  // Programs of the reservation on both sides leave a hole, not filler.
  if (
    previousEnd !== undefined &&
    previousEnd > first.startsAt &&
    nextStart < first.endsAt
  ) {
    return undefined;
  }
  // A later reservation the gap reaches before the next program extends it.
  let endsAt = first.endsAt;
  for (const range of later) {
    if (range.startsAt > nextStart) break;
    endsAt = range.endsAt;
  }
  return {
    type: "filler",
    channelId,
    scheduleRevision,
    startsAt,
    endsAt: Math.min(endsAt, nextStart),
  };
}

/**
 * Walks `window` in time order, yielding each entry airing in it and each
 * planned filler between them, and skipping gaps no reservation explains:
 * the one walk every window read shares, so programs and filler never
 * overlap or double up. `entries` must be in start order and hold the one
 * before the window and the one after it.
 */
export function walkCoverage<
  Entry extends Pick<PlayoutEntry, "startsAt" | "endsAt">,
>(
  window: { start: number; end: number },
  entries: readonly Entry[],
  filler: FillerInputs,
): ({ entry: Entry } | { filler: FillerPlayoutItem })[] {
  const walked: ({ entry: Entry } | { filler: FillerPlayoutItem })[] = [];
  let at = window.start;
  while (at < window.end) {
    const instant = at;
    const covering = entries.find(
      (entry) => entry.startsAt <= instant && instant < entry.endsAt,
    );
    if (covering !== undefined) {
      walked.push({ entry: covering });
      at = covering.endsAt;
      continue;
    }
    const planned = findFillerAt(instant, entries, filler);
    if (planned !== undefined) {
      walked.push({ filler: planned });
      at = planned.endsAt;
      continue;
    }
    // An unexplained gap: skip to the next entry, if any.
    at =
      entries.find((entry) => entry.startsAt > instant)?.startsAt ?? Infinity;
  }
  return walked;
}

/**
 * Lists the planned filler in `window` among entries known only by their
 * times, such as programming a preview generated but never stored.
 */
export function listPlannedFiller({
  window,
  entries,
  ...filler
}: FillerInputs & {
  window: { start: number; end: number };
  entries: readonly Pick<PlayoutEntry, "startsAt" | "endsAt">[];
}): FillerPlayoutItem[] {
  const cut = cutAtReservations(entries, filler.reservations);
  return walkCoverage(window, cut, filler).flatMap((step) =>
    "filler" in step ? [step.filler] : [],
  );
}
