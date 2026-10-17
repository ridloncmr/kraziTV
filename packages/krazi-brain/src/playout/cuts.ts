import type { PlayoutEntry, ReservedTimeRange } from "./contracts.js";

/**
 * Clips each entry at the first reservation start or end inside its airtime
 * (ADR 0015), the one cut rule every playout read applies before anything
 * else. Generation never stores such a crossing, so one exists only when the
 * owner chose it: an interrupting reservation starting inside the airing
 * item, or a running reservation ended early inside its own airing program.
 * The cut is derived, never stored, so dropping the reservation restores the
 * entry's full airtime. An entry the cut leaves alone keeps its identity.
 *
 * `reservations` must hold every reservation whose start or end falls
 * inside any of `entries`, however long ago it ended.
 */
export function cutAtReservations<
  Entry extends Pick<PlayoutEntry, "startsAt" | "endsAt">,
>(
  entries: readonly Entry[],
  reservations: readonly ReservedTimeRange[],
): Entry[] {
  return entries.map((entry) => {
    let endsAt = entry.endsAt;
    for (const range of reservations) {
      for (const boundary of [range.startsAt, range.endsAt]) {
        if (entry.startsAt < boundary && boundary < endsAt) endsAt = boundary;
      }
    }
    return endsAt === entry.endsAt ? entry : { ...entry, endsAt };
  });
}
