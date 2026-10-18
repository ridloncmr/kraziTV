import type {
  GeneratedScheduleEntry,
  GenerationResult,
  ScheduleMedia,
  ScheduleSource,
} from "../../schedule/contracts.js";
import {
  fitsBefore,
  isSchedulableMedia,
} from "../../schedule/schedule-policy.js";
import type {
  GeneratedBlock,
  LatestTurn,
  Reservation,
  RotationCheckpoint,
} from "../contracts.js";

/** What airing a reservation produced, for the generator to record. */
interface ReservationAiring {
  /** The block to record: one this call started that an entry aired in. */
  started: GeneratedBlock | undefined;
  /** A listed source's entries; a collection's are recorded by `airCollection`. */
  entries: GeneratedScheduleEntry[];
  /** Where generation continues: the reservation's end once its programs are done, else after the last program. */
  continuesAt: number;
}

/**
 * Airs the reservation generation has entered, from `startsAt`: its listed
 * items in saved order, or its collection through `airCollection`, which
 * generates into the caller's entries. Coverage always reaches the end of
 * every reservation it starts. Its block takes no rotation turn, so even a
 * fresh rebuild resumes a kept reservation block where its entries left off,
 * and a new block is recorded only once an entry airs in it: a range none of
 * whose programs fit leaves only filler.
 */
export function airReservation(
  reservation: Reservation,
  {
    startsAt,
    kept,
    previousEntry,
    state,
    nextSequenceNumber,
    maxEntries,
    createBlockId,
    airCollection,
  }: {
    startsAt: number;
    /** The latest kept block, when this call has generated nothing yet. */
    kept: LatestTurn | undefined;
    /** The last entry generated so far, which a range that airs nothing continues from. */
    previousEntry: GeneratedScheduleEntry | undefined;
    state: RotationCheckpoint;
    nextSequenceNumber: number;
    maxEntries: number;
    createBlockId: () => string;
    /** Generates a collection's programs through the reservation's end, recording them. */
    airCollection: (source: ScheduleSource) => GenerationResult;
  },
): ReservationAiring {
  const resumed =
    kept?.block.reservationId === reservation.id ? kept : undefined;
  const block =
    resumed?.block ??
    reservationBlock(reservation, createBlockId(), startsAt, state);
  const { source } = reservation;
  let entries: GeneratedScheduleEntry[] = [];
  let aired: GeneratedScheduleEntry[];
  let done: boolean;
  if (source.kind === "media_items") {
    const listed = airListedItems(source.items, reservation.endsAt, {
      programmingBlockId: block.id,
      startsAt,
      aired: resumed?.airedMediaItemIds ?? [],
      nextSequenceNumber,
      maxEntries,
    });
    entries = listed.entries;
    aired = listed.entries;
    done = listed.done;
  } else {
    const generated = airCollection({
      ...source,
      programmingBlockId: block.id,
    });
    aired = generated.kind === "generated" ? generated.entries : [];
    done =
      generated.kind !== "generated" ||
      generated.deferred ||
      generated.generatedThrough >= reservation.endsAt;
  }
  const last = aired.at(-1) ?? previousEntry;
  return {
    started: resumed === undefined && aired.length > 0 ? block : undefined,
    entries,
    continuesAt: done || last === undefined ? reservation.endsAt : last.endsAt,
  };
}

/** Returns the reservation whose half-open range holds `at`, if any. */
export function findReservationAt(
  reservations: readonly Reservation[],
  at: number,
): Reservation | undefined {
  return reservations.find(
    (reservation) => reservation.startsAt <= at && at < reservation.endsAt,
  );
}

/**
 * Returns the first reservation starting after `at`: the hard end ordinary
 * programming from `at` must stop whole before. `reservations` must be in
 * start order.
 */
export function findNextReservation(
  reservations: readonly Reservation[],
  at: number,
): Reservation | undefined {
  return reservations.find((reservation) => reservation.startsAt > at);
}

/**
 * Whether a reservation started after a turn began and by `at`, so the turn
 * is over: a reservation ends a started turn (programming spec 0004), even
 * one none of whose programs fit and which therefore left no block.
 */
export function reservationEndedTurn(
  reservations: readonly Reservation[],
  turnStartsAt: number,
  at: number,
): boolean {
  return reservations.some(
    (reservation) =>
      reservation.startsAt > turnStartsAt && reservation.startsAt <= at,
  );
}

/**
 * Builds the block a reservation's programs air in. It takes no rotation
 * turn, so it carries the rotation state as it stands unchanged, and
 * generation after it resumes from that state rather than advancing it. It
 * records the round it falls in, the active context's current one or the
 * first before any has formed, and how many turns that round has served.
 */
function reservationBlock(
  reservation: Reservation,
  id: string,
  startsAt: number,
  state: RotationCheckpoint,
): GeneratedBlock {
  const { source } = reservation;
  const round = state.contexts[state.activeContext];
  return {
    id,
    assignmentId: null,
    reservationId: reservation.id,
    source:
      source.kind === "collection"
        ? {
            kind: "collection",
            mediaCollectionId: source.mediaCollectionId,
            playbackMode: source.playbackMode,
          }
        : null,
    roundNumber: Math.max(round?.roundNumber ?? 0, 1),
    turnIndex: round?.served.length ?? 0,
    startsAt,
    size: null,
    marathon: false,
    winningRuleId: null,
    settingOrigins: { ordinary: "assignment", marathon: "disabled" },
    endedByEdit: false,
    checkpoint: state,
  };
}

/**
 * Airs a reserved media-item list from `startsAt` in saved order, until an
 * item would end past `endsAt` or `maxEntries` is reached. It resumes
 * after the items already `aired`, found by identity in order, so an item
 * that left the catalog since never shifts the rest. An unschedulable item
 * is passed over; an item that does not fit stops the list, because a
 * program is never cut. `done` is false only when `maxEntries` stopped it.
 */
function airListedItems(
  items: readonly ScheduleMedia[],
  endsAt: number,
  {
    programmingBlockId,
    startsAt,
    aired,
    nextSequenceNumber,
    maxEntries,
  }: {
    programmingBlockId: string;
    startsAt: number;
    aired: readonly string[];
    nextSequenceNumber: number;
    maxEntries: number;
  },
): { entries: GeneratedScheduleEntry[]; done: boolean } {
  let next = 0;
  for (const id of aired) {
    while (next < items.length && items[next]?.id !== id) next += 1;
    next += 1;
  }
  const entries: GeneratedScheduleEntry[] = [];
  let at = startsAt;
  for (const media of items.slice(next).filter(isSchedulableMedia)) {
    // The schedulability filter guarantees an integer duration.
    const durationMs = media.durationMs ?? 0;
    if (!fitsBefore(at, durationMs, endsAt)) break;
    if (entries.length === maxEntries) return { entries, done: false };
    entries.push({
      mediaItemId: media.id,
      title: media.title,
      startsAt: at,
      endsAt: at + durationMs,
      durationMs,
      sequenceNumber: nextSequenceNumber + entries.length,
      programmingBlockId,
      mediaCollectionId: null,
      playbackMode: null,
      playbackIndex: null,
    });
    at += durationMs;
  }
  return { entries, done: true };
}
