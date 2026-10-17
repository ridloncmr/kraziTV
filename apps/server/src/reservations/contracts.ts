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
 * A collection played once through from its first member in an ordered
 * mode (programming spec 0007): only a preview takes it, resolving it into
 * the media-item list the owner then saves, so the event keeps its own
 * placements whatever the collection does later.
 */
export interface FromBeginningSource {
  kind: "collection_from_beginning";
  mediaCollectionId: string;
  playbackMode: Exclude<PlaybackMode, "random">;
}

/** What a preview takes: what a save takes, or a collection from the beginning. */
export type PreviewSettings = Omit<ReservationSettings, "source"> & {
  source: ReservationSourceSettings | FromBeginningSource;
};

/**
 * What the owner saves for one reservation; the API accepts it. An end of
 * null asks for a program-derived end, which only a media-item list has. A
 * start of "now" is the server's clock inside the write, so browser clock
 * skew never places a cut. `interrupts` lets it start inside the airing
 * item and cut it there (ADR 0015).
 */
export interface ReservationSettings {
  startsAt: number | "now";
  endsAt: number | null;
  interrupts: boolean;
  source: ReservationSourceSettings;
}

/**
 * What a save must carry beyond the settings (programming spec 0007): the
 * schedule revision its preview read, so a save never publishes a schedule
 * the owner did not see, and, for a create, the browser's key for this save,
 * so a retry finds what it created.
 */
export interface SaveGuards {
  expectedScheduleRevision: number | null;
  requestKey?: string;
}

/** A saved reservation, with the end it stores whichever kind it is. */
export interface SavedReservation {
  id: string;
  channelId: string;
  startsAt: number;
  endsAt: number;
  endKind: "explicit" | "program_derived";
  /** The owner let it cut the airing item at its start; kept once it starts. */
  interrupts: boolean;
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
  | { kind: "reservation_too_far"; latestStartsAt: number }
  /** The schedule changed since the preview the save was made from. */
  | { kind: "preview_stale" }
  | { kind: "reservation_started"; startsAt: number }
  /** Only a running reservation can end early; one not started is edited or cancelled. */
  | { kind: "reservation_not_started"; startsAt: number }
  | { kind: "reservation_ended"; endsAt: number }
  | {
      kind: "reservation_end_out_of_range";
      earliestEndsAt: number;
      latestEndsAt: number;
    }
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
  /** A retry of a save that already created this reservation. */
  | { kind: "repeated"; reservation: SavedReservation }
  | { kind: "channel_not_found" }
  | ReservationRefusal;

export type UpdateReservationResult =
  | { kind: "updated" | "unchanged"; reservation: SavedReservation }
  | { kind: "not_found" }
  | ReservationRefusal;

/**
 * When a running reservation should end instead (ADR 0015): at a chosen
 * instant from now through its current end, or when the program airing in
 * it ends, which is now during its filler.
 */
export type EarlyEnd = { endsAt: number } | { after: "airing" };

export type EndReservationResult =
  | { kind: "ended" | "unchanged"; reservation: SavedReservation }
  | { kind: "not_found" }
  | Extract<
      ReservationRefusal,
      {
        kind:
          | "reservation_not_started"
          | "reservation_ended"
          | "reservation_end_out_of_range";
      }
    >;

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
  | {
      kind: "unschedulable";
      reason: ProgrammingUnschedulableReason;
      /** A reservation still airs on such a channel, so a save needs this. */
      scheduleRevision: number | null;
    }
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
      /**
       * Whether it starts past the channel's coverage, where ordinary
       * programming is planned only when generation reaches it.
       */
      beyondHorizon: boolean;
      /** What it airs: a collection's programs are estimated beyond the horizon. */
      sourceKind: ReservationSourceSettings["kind"];
      /** A collection from the beginning, resolved into the list to save. */
      mediaItemIds?: string[];
      /** Where the previewed programming starts: after what airs now. */
      boundary: number;
      reservations: Reservation[];
      /** The block the reservation's programs air in; none when nothing fits. */
      reservationBlockId: string | undefined;
      entries: GeneratedScheduleEntry[];
    };
