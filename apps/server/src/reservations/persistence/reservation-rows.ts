import type { Reservation } from "@krazitv/krazi-brain";
import {
  type ExpressionBuilder,
  type Kysely,
  type RawBuilder,
  type Selectable,
  sql,
} from "kysely";

import { fromSqliteBoolean } from "../../database/columns/sqlite-boolean.js";
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
 * by `reservationId` (one owned by another channel is not found), only the
 * one a save with `requestKey` created, or only those ending after
 * `endingAfter`.
 */
export async function readReservations(
  trx: Executor,
  channelId: string,
  {
    reservationId,
    requestKey,
    endingAfter,
  }: { reservationId?: string; requestKey?: string; endingAfter?: number } = {},
): Promise<SavedReservation[]> {
  let query = trx
    .selectFrom("reservations")
    .selectAll()
    .where("channel_id", "=", channelId);
  if (reservationId !== undefined) {
    query = query.where("id", "=", reservationId);
  }
  if (requestKey !== undefined) {
    query = query.where("request_key", "=", requestKey);
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
  await settleAiredCuts(
    trx,
    await trx
      .selectFrom("reservations")
      .select([
        "channel_id as channelId",
        "starts_at as startsAt",
        "ends_at as endsAt",
      ])
      .where("ends_at", "<=", now)
      .where((eb) => playingFilter(eb, playing))
      .execute(),
    now,
  );
  await trx
    .deleteFrom("reservations")
    .where("ends_at", "<=", now)
    .where((eb) => playingFilter(eb, playing))
    .execute();
}

/**
 * Writes every cut a reservation made that has already aired into the cut
 * entry's stored end, before the reservation is deleted (ADR 0015): an aired
 * cut can never be withdrawn, and without its reservation nothing would
 * derive it, so history would show the cut program overlapping what aired.
 */
export async function settleAiredCuts(
  trx: Executor,
  reservations: readonly Pick<
    SavedReservation,
    "channelId" | "startsAt" | "endsAt"
  >[],
  now: number,
): Promise<void> {
  for (const reservation of reservations) {
    for (const cut of [reservation.startsAt, reservation.endsAt]) {
      if (cut > now) continue;
      await trx
        .updateTable("schedule_entries")
        .set({ ends_at: cut, duration_ms: sql<number>`${cut} - starts_at` })
        .where("channel_id", "=", reservation.channelId)
        .where("starts_at", "<", cut)
        .where("ends_at", ">", cut)
        .execute();
    }
  }
}

// Matches the reservations that play a collection or any of the given items.
function playingFilter(
  eb: ExpressionBuilder<DatabaseSchema, "reservations">,
  playing: { mediaCollectionId: string } | { mediaItemIds: RawBuilder<string> },
) {
  return "mediaCollectionId" in playing
    ? eb("media_collection_id", "=", playing.mediaCollectionId)
    : eb(
        "id",
        "in",
        eb
          .selectFrom("reservation_items")
          .select("reservation_id")
          .where("media_item_id", "in", playing.mediaItemIds),
      );
}

/**
 * Clears the interrupting flag on the channel's reservations that have not
 * started, when the owner's interruption replaces what airs: the item they
 * cut is gone, and a stored flag must always mean a cut of what airs.
 */
export async function clearUnstartedInterruptions(
  trx: Executor,
  channelId: string,
  now: number,
): Promise<void> {
  await trx
    .updateTable("reservations")
    .set({ interrupts: 0 })
    .where("channel_id", "=", channelId)
    .where("interrupts", "=", 1)
    .where("starts_at", ">", now)
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
    interrupts: fromSqliteBoolean(row.interrupts),
    source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
