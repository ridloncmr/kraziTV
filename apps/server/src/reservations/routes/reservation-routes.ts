import { listPlannedFiller, PLAYBACK_MODES } from "@krazitv/krazi-brain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { ChannelRepository } from "../../channels/repository/channel-repository.js";
import {
  sendApiError,
  sendChannelNotFound,
  sendInvalidRequest,
} from "../../http/api-error.js";
import { toApiTimestamp } from "../../http/api-timestamp.js";
import { idParams, isoInstantField } from "../../http/request-schemas.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import type {
  ReservationPreview,
  ReservationRefusal,
  SavedReservation,
} from "../contracts.js";
import type { ReservationRepository } from "../persistence/reservation-repository.js";
import { AiringFillerConflictError } from "../airing-filler-conflict-error.js";
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
    const result = await refusingAiringFillerChanges(() =>
      schedules.applyInputChange(
        request.log,
        "reservation_created",
        reservationChange(id, "created", (trx, now) =>
          reservations.create(trx, id, body.data, now),
        ),
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

  // What saving the body would air, computed without writing anything.
  server.post("/channels/:id/reservations/preview", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = reservationBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const preview = await schedules.previewReservation(
      id,
      body.data,
      request.log,
    );
    switch (preview.kind) {
      case "channel_not_found":
        return sendChannelNotFound(reply, id);
      case "unschedulable":
        return sendApiError(
          reply,
          409,
          "channel_unschedulable",
          `Channel ${id} cannot generate a schedule`,
          { reason: preview.reason },
        );
      case "refused": {
        const { status: _, ...conflict } = describeRefusal(preview.refusal);
        return {
          scheduleRevision: preview.scheduleRevision,
          commitment: "exact",
          conflicts: [conflict],
        };
      }
      case "preview":
        return toApiReservationPreview(id, preview);
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
      const result = await refusingAiringFillerChanges(() =>
        schedules.applyInputChange(
          request.log,
          "reservation_changed",
          reservationChange(id, "updated", (trx, now) =>
            reservations.update(trx, id, reservationId, body.data, now),
          ),
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
      const result = await refusingAiringFillerChanges(() =>
        schedules.applyInputChange(
          request.log,
          "reservation_deleted",
          reservationChange(id, "deleted", (trx, now) =>
            reservations.delete(trx, id, reservationId, now),
          ),
        ),
      );
      switch (result.kind) {
        case "deleted":
          return reply.status(204).send();
        case "not_found":
          return sendReservationNotFound(reply, id, reservationId);
        default:
          return sendRefusal(reply, result);
      }
    },
  );
}

/**
 * Runs a reservation write, answering one that rolled back because it would
 * change the planned filler airing now as that refusal.
 */
async function refusingAiringFillerChanges<T>(
  run: () => Promise<T>,
): Promise<
  T | Extract<ReservationRefusal, { kind: "airing_filler_conflict" }>
> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AiringFillerConflictError) {
      return {
        kind: "airing_filler_conflict",
        fillerEndsAt: error.fillerEndsAt,
      };
    }
    throw error;
  }
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

/** Sends a refusal with the status, code, and words `describeRefusal` gives it. */
function sendRefusal(reply: FastifyReply, refusal: ReservationRefusal) {
  const { status, code, message, ...details } = describeRefusal(refusal);
  return sendApiError(reply, status, code, message, details);
}

/**
 * Describes each refusal once, for a save and a preview alike: a body naming
 * what does not exist or cannot fit is a 400; a range the schedule or
 * catalog refuses now is a 409.
 */
function describeRefusal(refusal: ReservationRefusal): {
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
function toApiReservationPreview(
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
