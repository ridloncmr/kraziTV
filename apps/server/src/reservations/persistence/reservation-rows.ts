import type { Reservation } from "@krazitv/krazi-brain";
import type { Kysely, RawBuilder, Selectable } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ReservationTable } from "../../database/schema/reservation-table.js";
import {
  loadCollectionMembers,
  loadScheduleMedia,
} from "../../schedules/persistence/assignment-sources.js";
import type {
  ReservationSourceSettings,
  SavedReservation,
} from "../contracts.js";

// Every function here takes the caller's executor, so a reservation write
// and the regeneration that follows it read one consistent state.

type Executor = Kysely<DatabaseSchema>;

/**
 * Loads the channel's reservations ending after `after` as kraziPlan reads
 * them, in start order, with each one's media resolved as scheduling sees
 * it. Ended ones are history generation never needs again.
 */
export async function loadReservations(
  trx: Executor,
  channelId: string,
  after: number,
): Promise<Reservation[]> {
  const saved = await readReservations(trx, channelId, { endingAfter: after });
  const reservations: Reservation[] = [];
  for (const reservation of saved) {
    reservations.push(await resolveReservation(trx, reservation));
  }
  return reservations;
}

/**
 * Resolves a reservation's range and source into what kraziPlan reads, its
 * media as scheduling sees it, whether it is saved or only previewed.
 */
export async function resolveReservation(
  trx: Executor,
  reservation: Pick<SavedReservation, "id" | "startsAt" | "endsAt" | "source">,
): Promise<Reservation> {
  const { source } = reservation;
  return {
    id: reservation.id,
    startsAt: reservation.startsAt,
    endsAt: reservation.endsAt,
    source:
      source.kind === "media_items"
        ? {
            kind: "media_items",
            items: await loadScheduleMedia(trx, source.mediaItemIds),
          }
        : {
            ...source,
            members: await loadCollectionMembers(trx, source.mediaCollectionId),
          },
  };
}

/**
 * Reads a channel's saved reservations in start order, only the one named
 * by `reservationId` (one owned by another channel is not found), or only
 * those ending after `endingAfter`.
 */
export async function readReservations(
  trx: Executor,
  channelId: string,
  {
    reservationId,
    endingAfter,
  }: { reservationId?: string; endingAfter?: number } = {},
): Promise<SavedReservation[]> {
  let query = trx
    .selectFrom("reservations")
    .selectAll()
    .where("channel_id", "=", channelId);
  if (reservationId !== undefined) {
    query = query.where("id", "=", reservationId);
  }
  if (endingAfter !== undefined) {
    query = query.where("ends_at", ">", endingAfter);
  }
  const rows = await query.orderBy("starts_at").orderBy("id").execute();
  const saved: SavedReservation[] = [];
  for (const row of rows) {
    saved.push(toSavedReservation(row, await readSource(trx, row)));
  }
  return saved;
}

/**
 * Deletes the reservations that ended by `now` and play a collection or
 * any of the given media items, so removing what they aired leaves no
 * reference behind. Their blocks keep the reservation ID as history.
 */
export async function deleteEndedReservations(
  trx: Executor,
  playing: { mediaCollectionId: string } | { mediaItemIds: RawBuilder<string> },
  now: number,
): Promise<void> {
  await trx
    .deleteFrom("reservations")
    .where("ends_at", "<=", now)
    .where((eb) =>
      "mediaCollectionId" in playing
        ? eb("media_collection_id", "=", playing.mediaCollectionId)
        : eb(
            "id",
            "in",
            eb
              .selectFrom("reservation_items")
              .select("reservation_id")
              .where("media_item_id", "in", playing.mediaItemIds),
          ),
    )
    .execute();
}

/** Writes a reservation's media items in saved order, replacing any it had. */
export async function writeReservationItems(
  trx: Executor,
  reservationId: string,
  source: ReservationSourceSettings,
): Promise<void> {
  await trx
    .deleteFrom("reservation_items")
    .where("reservation_id", "=", reservationId)
    .execute();
  if (source.kind !== "media_items") return;
  await trx
    .insertInto("reservation_items")
    .values(
      source.mediaItemIds.map((mediaItemId, position) => ({
        reservation_id: reservationId,
        position,
        media_item_id: mediaItemId,
      })),
    )
    .execute();
}

/** Flattens a source into the columns the table check expects. */
export function toSourceColumns(source: ReservationSourceSettings) {
  return source.kind === "collection"
    ? {
        source_kind: "collection" as const,
        media_collection_id: source.mediaCollectionId,
        playback_mode: source.playbackMode,
      }
    : {
        source_kind: "media_items" as const,
        media_collection_id: null,
        playback_mode: null,
      };
}

// Rebuilds a row's source; the table check makes a collection's columns non-null.
async function readSource(
  trx: Executor,
  row: Selectable<ReservationTable>,
): Promise<ReservationSourceSettings> {
  if (row.source_kind === "collection") {
    if (row.media_collection_id === null || row.playback_mode === null) {
      throw new Error("a collection reservation names its collection and mode");
    }
    return {
      kind: "collection",
      mediaCollectionId: row.media_collection_id,
      playbackMode: row.playback_mode,
    };
  }
  const items = await trx
    .selectFrom("reservation_items")
    .select("media_item_id")
    .where("reservation_id", "=", row.id)
    .orderBy("position")
    .execute();
  return {
    kind: "media_items",
    mediaItemIds: items.map((item) => item.media_item_id),
  };
}

// Keeps the row shape inside this module.
function toSavedReservation(
  row: Selectable<ReservationTable>,
  source: ReservationSourceSettings,
): SavedReservation {
  return {
    id: row.id,
    channelId: row.channel_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    endKind: row.end_kind,
    source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
