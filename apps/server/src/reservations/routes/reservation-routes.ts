import { PLAYBACK_MODES } from "@krazitv/krazi-brain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { ChannelRepository } from "../../channels/repository/channel-repository.js";
import {
  sendApiError,
  sendChannelNotFound,
  sendInvalidRequest,
  sendUnknownMediaItems,
} from "../../http/api-error.js";
import { toApiTimestamp } from "../../http/api-timestamp.js";
import { idParams, isoInstantField } from "../../http/request-schemas.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import type { ReservationRefusal, SavedReservation } from "../contracts.js";
import type { ReservationRepository } from "../persistence/reservation-repository.js";
import { reservationChange } from "../reservation-change.js";

// What a reservation airs: media items in order, repeats allowed, or one
// collection in one mode.
const reservationSource = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("media_items"),
    mediaItemIds: z.array(z.string()).min(1),
  }),
  z.strictObject({
    kind: z.literal("collection"),
    mediaCollectionId: z.string(),
    playbackMode: z.enum(PLAYBACK_MODES),
  }),
]);

// Create and PATCH share one body: PATCH replaces the whole reservation. A
// null end is derived from the listed programs, so a collection, whose fit
// is unknown until it airs, needs an explicit one.
const reservationBody = z
  .strictObject({
    startsAt: isoInstantField,
    endsAt: isoInstantField.nullable().default(null),
    source: reservationSource,
  })
  .refine((body) => body.endsAt === null || body.endsAt > body.startsAt, {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  })
  .refine((body) => body.source.kind !== "collection" || body.endsAt !== null, {
    message: "a collection reservation needs an explicit endsAt",
    path: ["endsAt"],
  });

const reservationParams = z.object({
  id: z.string(),
  reservationId: z.string(),
});

/** Registers reservation HTTP routes; validation and status mapping live only here. */
export function registerReservationRoutes(
  server: FastifyInstance,
  reservations: ReservationRepository,
  channels: ChannelRepository,
  schedules: ScheduleService,
): void {
  server.get("/channels/:id/reservations", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    // The repository lists nothing for an unknown channel; the API says so instead.
    if ((await channels.findById(id)) === undefined) {
      return sendChannelNotFound(reply, id);
    }
    return (await reservations.listForChannel(id)).map(toApiReservation);
  });

  server.post("/channels/:id/reservations", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = reservationBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const result = await schedules.applyInputChange(
      request.log,
      "reservation_created",
      reservationChange(id, "created", (trx, now) =>
        reservations.create(trx, id, body.data, now),
      ),
    );
    switch (result.kind) {
      case "created":
        return reply.status(201).send(toApiReservation(result.reservation));
      case "channel_not_found":
        return sendChannelNotFound(reply, id);
      default:
        return sendRefusal(reply, result);
    }
  });

  server.patch(
    "/channels/:id/reservations/:reservationId",
    async (request, reply) => {
      const { id, reservationId } = reservationParams.parse(request.params);
      const body = reservationBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }
      // Unchanged settings affect no channel, so nothing regenerates.
      const result = await schedules.applyInputChange(
        request.log,
        "reservation_changed",
        reservationChange(id, "updated", (trx, now) =>
          reservations.update(trx, id, reservationId, body.data, now),
        ),
      );
      switch (result.kind) {
        case "updated":
        case "unchanged":
          return toApiReservation(result.reservation);
        case "not_found":
          return sendReservationNotFound(reply, id, reservationId);
        default:
          return sendRefusal(reply, result);
      }
    },
  );

  server.delete(
    "/channels/:id/reservations/:reservationId",
    async (request, reply) => {
      const { id, reservationId } = reservationParams.parse(request.params);
      const result = await schedules.applyInputChange(
        request.log,
        "reservation_deleted",
        reservationChange(id, "deleted", (trx) =>
          reservations.delete(trx, id, reservationId),
        ),
      );
      if (result.kind === "not_found") {
        return sendReservationNotFound(reply, id, reservationId);
      }
      return reply.status(204).send();
    },
  );
}

// A reservation owned by another channel is reported the same as a missing one.
function sendReservationNotFound(
  reply: FastifyReply,
  channelId: string,
  reservationId: string,
) {
  return sendApiError(
    reply,
    404,
    "reservation_not_found",
    `Channel ${channelId} has no reservation ${reservationId}`,
  );
}

// Maps each refusal to its status: a body naming what does not exist or
// cannot fit is a 400; a range the schedule or catalog refuses now is a 409.
function sendRefusal(reply: FastifyReply, refusal: ReservationRefusal) {
  switch (refusal.kind) {
    case "media_item_not_found":
      return sendUnknownMediaItems(reply, refusal.mediaItemIds);
    case "media_collection_not_found":
      return sendApiError(
        reply,
        400,
        "media_collection_not_found",
        `Media collection ${refusal.mediaCollectionId} does not exist`,
      );
    case "reservation_does_not_fit":
      return sendApiError(
        reply,
        400,
        refusal.kind,
        "The listed programs do not fit before the reservation's end",
        { programsEndAt: toApiTimestamp(refusal.programsEndAt) },
      );
    case "reservation_in_past":
      return sendApiError(
        reply,
        409,
        refusal.kind,
        "A reservation must start in the future",
        { startsAt: toApiTimestamp(refusal.startsAt) },
      );
    case "reservation_started":
      return sendApiError(
        reply,
        409,
        refusal.kind,
        "A reservation that has started cannot be edited; delete it instead",
        { startsAt: toApiTimestamp(refusal.startsAt) },
      );
    case "reservation_crosses_airing":
      return sendApiError(
        reply,
        409,
        refusal.kind,
        "A reservation cannot start before what is airing ends",
        { airingEndsAt: toApiTimestamp(refusal.airingEndsAt) },
      );
    case "reservation_overlap":
      return sendApiError(
        reply,
        409,
        refusal.kind,
        `The range overlaps reservation ${refusal.reservationId}`,
        { reservationId: refusal.reservationId },
      );
    case "reservation_media_unplayable":
      return sendApiError(
        reply,
        409,
        refusal.kind,
        `Media items cannot air: ${refusal.mediaItemIds.join(", ")}`,
        { mediaItemIds: refusal.mediaItemIds },
      );
  }
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
function toApiReservation(reservation: SavedReservation) {
  return {
    id: reservation.id,
    channelId: reservation.channelId,
    startsAt: toApiTimestamp(reservation.startsAt),
    endsAt: toApiTimestamp(reservation.endsAt),
    endKind: reservation.endKind,
    source: reservation.source,
    createdAt: toApiTimestamp(reservation.createdAt),
    updatedAt: toApiTimestamp(reservation.updatedAt),
  };
}
