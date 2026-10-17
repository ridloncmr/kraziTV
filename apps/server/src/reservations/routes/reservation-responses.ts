import { listPlannedFiller } from "@krazitv/krazi-brain";

import { toApiTimestamp } from "../../http/api-timestamp.js";
import type {
  ReservationPreview,
  ReservationRefusal,
  SavedReservation,
} from "../contracts.js";

// How the reservation routes word their answers: each refusal's status and
// words, and the API shapes of a reservation and its preview.

/**
 * Describes each refusal once, for a save and a preview alike: a body naming
 * what does not exist or cannot fit is a 400; a range the schedule or
 * catalog refuses now is a 409.
 */
export function describeRefusal(refusal: ReservationRefusal): {
  status: 400 | 409;
  code: ReservationRefusal["kind"];
  message: string;
  [detail: string]: unknown;
} {
  switch (refusal.kind) {
    case "media_item_not_found":
      return {
        status: 400,
        code: refusal.kind,
        message: `Unknown media items: ${refusal.mediaItemIds.join(", ")}`,
      };
    case "media_collection_not_found":
      return {
        status: 400,
        code: refusal.kind,
        message: `Media collection ${refusal.mediaCollectionId} does not exist`,
      };
    case "reservation_does_not_fit":
      return {
        status: 400,
        code: refusal.kind,
        message: "The listed programs do not fit before the reservation's end",
        programsEndAt: toApiTimestamp(refusal.programsEndAt),
      };
    case "reservation_in_past":
      return {
        status: 409,
        code: refusal.kind,
        message: "A reservation must start in the future",
        startsAt: toApiTimestamp(refusal.startsAt),
      };
    case "reservation_started":
      return {
        status: 409,
        code: refusal.kind,
        message:
          "A reservation that has started cannot be edited; delete it instead",
        startsAt: toApiTimestamp(refusal.startsAt),
      };
    case "reservation_not_started":
      return {
        status: 409,
        code: refusal.kind,
        message:
          "A special that has not started cannot end early; edit or cancel it instead",
        startsAt: toApiTimestamp(refusal.startsAt),
      };
    case "reservation_too_far":
      return {
        status: 409,
        code: refusal.kind,
        message: "A special can start at most a year ahead",
        latestStartsAt: toApiTimestamp(refusal.latestStartsAt),
      };
    case "preview_stale":
      return {
        status: 409,
        code: refusal.kind,
        message:
          "The schedule changed since this preview; preview again before saving",
      };
    case "reservation_ended":
      return {
        status: 409,
        code: refusal.kind,
        message: "This special has already ended",
        endsAt: toApiTimestamp(refusal.endsAt),
      };
    case "reservation_end_out_of_range":
      return {
        status: 409,
        code: refusal.kind,
        message:
          "A running special can only end from now through its current end",
        earliestEndsAt: toApiTimestamp(refusal.earliestEndsAt),
        latestEndsAt: toApiTimestamp(refusal.latestEndsAt),
      };
    case "airing_filler_conflict":
      return {
        status: 409,
        code: refusal.kind,
        message:
          "The filler airing now depends on this reservation, so changing it would change what airs",
        fillerEndsAt: toApiTimestamp(refusal.fillerEndsAt),
      };
    case "reservation_crosses_airing":
      return {
        status: 409,
        code: refusal.kind,
        message: "A reservation cannot start before what is airing ends",
        airingEndsAt: toApiTimestamp(refusal.airingEndsAt),
      };
    case "reservation_overlap":
      return {
        status: 409,
        code: refusal.kind,
        message: `The range overlaps reservation ${refusal.reservationId}`,
        reservationId: refusal.reservationId,
      };
    case "reservation_media_unplayable":
      return {
        status: 409,
        code: refusal.kind,
        message: `Media items cannot air: ${refusal.mediaItemIds.join(", ")}`,
        mediaItemIds: refusal.mediaItemIds,
      };
  }
}

/**
 * Explains a previewed reservation: its exact range, the programs it airs,
 * the planned filler before it and inside its range, and the ordinary
 * program deferred past it. The start is an exact commitment, unlike a
 * programming rule's soft calendar preference.
 */
export function toApiReservationPreview(
  channelId: string,
  preview: Extract<ReservationPreview, { kind: "preview" }>,
) {
  const reserved = preview.entries.filter(
    (entry) => entry.programmingBlockId === preview.reservationBlockId,
  );
  const filler = listPlannedFiller({
    channelId,
    scheduleRevision: preview.scheduleRevision ?? 0,
    reservations: preview.reservations,
    // Nothing before the boundary is previewed, so filler starts there at the earliest.
    anchorTime: preview.boundary,
    window: { start: preview.boundary, end: preview.endsAt },
    entries: preview.entries,
  });
  const before = filler.find(
    (interval) => interval.startsAt < preview.startsAt,
  );
  const inside = filler.find(
    (interval) => interval.startsAt >= preview.startsAt,
  );
  const deferred =
    before === undefined
      ? undefined
      : preview.entries.find(
          (entry) =>
            entry.startsAt >= preview.endsAt &&
            entry.programmingBlockId !== preview.reservationBlockId,
        );
  const interval = (item: { startsAt: number; endsAt: number }) => ({
    startsAt: toApiTimestamp(item.startsAt),
    endsAt: toApiTimestamp(item.endsAt),
  });
  return {
    scheduleRevision: preview.scheduleRevision,
    commitment: "exact",
    startsAt: toApiTimestamp(preview.startsAt),
    endsAt: toApiTimestamp(preview.endsAt),
    endKind: preview.endKind,
    programs: reserved.map((entry) => ({
      mediaItemId: entry.mediaItemId,
      title: entry.title,
      ...interval(entry),
    })),
    fillerBefore: before === undefined ? null : interval(before),
    fillerInside: inside === undefined ? null : interval(inside),
    deferredProgram:
      deferred === undefined
        ? null
        : { mediaItemId: deferred.mediaItemId, title: deferred.title },
    conflicts: [],
  };
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
export function toApiReservation(reservation: SavedReservation) {
  return {
    id: reservation.id,
    channelId: reservation.channelId,
    startsAt: toApiTimestamp(reservation.startsAt),
    endsAt: toApiTimestamp(reservation.endsAt),
    endKind: reservation.endKind,
    interrupts: reservation.interrupts,
    source: reservation.source,
    createdAt: toApiTimestamp(reservation.createdAt),
    updatedAt: toApiTimestamp(reservation.updatedAt),
  };
}
