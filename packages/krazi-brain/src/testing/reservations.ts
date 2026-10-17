import type { Reservation } from "../krazi-plan/contracts.js";
import type { PlaybackMode, ScheduleMedia } from "../schedule/contracts.js";

/** Builds a reservation that airs `items` in order across `[startsAt, endsAt)`. */
export function itemsReservation(
  id: string,
  startsAt: number,
  endsAt: number,
  items: readonly ScheduleMedia[],
): Reservation {
  return { id, startsAt, endsAt, source: { kind: "media_items", items } };
}

/**
 * Builds a reservation that airs one collection in `playbackMode`, as many
 * whole programs as fit in `[startsAt, endsAt)`.
 */
export function collectionReservation(
  id: string,
  startsAt: number,
  endsAt: number,
  mediaCollectionId: string,
  members: readonly ScheduleMedia[],
  playbackMode: PlaybackMode = "chronological",
): Reservation {
  return {
    id,
    startsAt,
    endsAt,
    source: { kind: "collection", mediaCollectionId, playbackMode, members },
  };
}
