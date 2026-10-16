import type {
  GeneratedScheduleEntry,
  ScheduleMedia,
} from "../../schedule/contracts.js";
import { isSchedulableMedia } from "../../schedule/schedule-policy.js";
import type {
  GeneratedBlock,
  Reservation,
  RotationCheckpoint,
} from "../contracts.js";

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
export function reservationBlock(
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
export function airListedItems(
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
    if (at + durationMs > endsAt) break;
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
