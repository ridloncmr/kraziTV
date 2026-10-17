import type {
  GeneratedScheduleEntry,
  PlaybackMode,
  ProgrammingUnschedulableReason,
  Reservation,
} from "@krazitv/krazi-brain";

/**
 * What a reservation airs, as the owner saves it: media items in order, or
 * one collection in one playback mode.
 */
export type ReservationSourceSettings =
  | { kind: "media_items"; mediaItemIds: string[] }
  | {
      kind: "collection";
      mediaCollectionId: string;
      playbackMode: PlaybackMode;
    };

/**
 * What the owner saves for one reservation; the API accepts it. An end of
 * null asks for a program-derived end, which only a media-item list has.
 */
export interface ReservationSettings {
  startsAt: number;
  endsAt: number | null;
  source: ReservationSourceSettings;
}

/** A saved reservation, with the end it stores whichever kind it is. */
export interface SavedReservation {
  id: string;
  channelId: string;
  startsAt: number;
  endsAt: number;
  endKind: "explicit" | "program_derived";
  source: ReservationSourceSettings;
  createdAt: number;
  updatedAt: number;
}

/**
 * Why a reservation cannot be saved: the range is unusable where it is, or
 * what it airs cannot fill it.
 */
export type ReservationRefusal =
  | { kind: "reservation_in_past"; startsAt: number }
  | { kind: "reservation_started"; startsAt: number }
  /** The filler airing now depends on this reservation, so changing it would change what airs. */
  | { kind: "airing_filler_conflict"; fillerEndsAt: number }
  | { kind: "reservation_crosses_airing"; airingEndsAt: number }
  | { kind: "reservation_overlap"; reservationId: string }
  | { kind: "reservation_does_not_fit"; programsEndAt: number }
  | { kind: "reservation_media_unplayable"; mediaItemIds: string[] }
  | { kind: "media_item_not_found"; mediaItemIds: string[] }
  | { kind: "media_collection_not_found"; mediaCollectionId: string };

export type CreateReservationResult =
  | { kind: "created"; reservation: SavedReservation }
  | { kind: "channel_not_found" }
  | ReservationRefusal;

export type UpdateReservationResult =
  | { kind: "updated" | "unchanged"; reservation: SavedReservation }
  | { kind: "not_found" }
  | ReservationRefusal;

export type DeleteReservationResult =
  | { kind: "deleted" }
  | { kind: "not_found" }
  | Extract<ReservationRefusal, { kind: "airing_filler_conflict" }>;

/**
 * What saving a reservation would air, computed without writing: its range,
 * the programming a regeneration with it would generate from the boundary,
 * and every reservation that programming honors, or why it cannot be saved.
 */
export type ReservationPreview =
  | { kind: "channel_not_found" }
  | { kind: "unschedulable"; reason: ProgrammingUnschedulableReason }
  | {
      kind: "refused";
      refusal: ReservationRefusal;
      scheduleRevision: number | null;
    }
  | {
      kind: "preview";
      scheduleRevision: number | null;
      startsAt: number;
      endsAt: number;
      endKind: SavedReservation["endKind"];
      /** Where the previewed programming starts: after what airs now. */
      boundary: number;
      reservations: Reservation[];
      /** The block the reservation's programs air in; none when nothing fits. */
      reservationBlockId: string | undefined;
      entries: GeneratedScheduleEntry[];
    };
