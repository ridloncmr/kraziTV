import { PLAYBACK_MODES } from "@krazitv/krazi-brain";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";

import type { ChannelRuntime } from "../../channels/contracts.js";
import type { ChannelRepository } from "../../channels/repository/channel-repository.js";
import {
  sendApiError,
  sendChannelNotFound,
  sendInvalidRequest,
} from "../../http/api-error.js";
import { idParams, isoInstantField } from "../../http/request-schemas.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ScheduleChangeReason } from "../../schedules/contracts.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import type { ReservationRefusal } from "../contracts.js";
import type { ReservationRepository } from "../persistence/reservation-repository.js";
import { AiringFillerConflictError } from "../airing-filler-conflict-error.js";
import { reservationChange } from "../reservation-change.js";
import {
  describeRefusal,
  toApiReservation,
  toApiReservationPreview,
} from "./reservation-responses.js";

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

// Preview, create, and PATCH share these fields: PATCH replaces the whole
// reservation. A null end is derived from the listed programs, so a
// collection, whose fit is unknown until it airs, needs an explicit one. A
// start of "now" is resolved on the server inside the write; `interrupts`
// lets the start fall inside the airing item and cut it (ADR 0015).
const reservationFields = {
  startsAt: z.union([z.literal("now"), isoInstantField]),
  endsAt: isoInstantField.nullable().default(null),
  interrupts: z.boolean().default(false),
  source: reservationSource,
};

// A save also names the programming revision its preview read; a create
// adds the browser's key for this save, repeated unchanged on a retry.
const expectedProgrammingRevision = z.number().int().nonnegative().nullable();

const reservationObject = z.strictObject(reservationFields);

/** The fields the range checks read, whichever body carries them. */
type RangeFields = {
  startsAt: number | "now";
  endsAt: number | null;
  source: { kind: string };
};

/** Adds the range checks every body shares to one of the bodies. */
function withRangeChecks<T extends z.ZodType<RangeFields>>(schema: T) {
  return schema
    .refine(
      (body) =>
        body.endsAt === null ||
        body.startsAt === "now" ||
        body.endsAt > body.startsAt,
      { message: "endsAt must be after startsAt", path: ["endsAt"] },
    )
    .refine(
      (body) => body.source.kind !== "collection" || body.endsAt !== null,
      {
        message: "a collection reservation needs an explicit endsAt",
        path: ["endsAt"],
      },
    );
}

// Only a preview plays a collection from the beginning, in an ordered mode:
// the owner saves the list it resolves to (programming spec 0007).
const previewSource = z.discriminatedUnion("kind", [
  ...reservationSource.options,
  z.strictObject({
    kind: z.literal("collection_from_beginning"),
    mediaCollectionId: z.string(),
    playbackMode: z.enum(["chronological", "episode", "release"]),
  }),
]);
// An edit's preview names the special it replaces, which it leaves out.
const previewBody = withRangeChecks(
  reservationObject.extend({
    source: previewSource,
    replacesReservationId: z.string().optional(),
  }),
);
const createBody = withRangeChecks(
  reservationObject.extend({
    expectedProgrammingRevision,
    requestKey: z.string().min(1).max(200),
  }),
);
const updateBody = withRangeChecks(
  reservationObject.extend({ expectedProgrammingRevision }),
);

// Ending a running reservation early: at an instant, or after what airs.
const earlyEndBody = z.union([
  z.strictObject({ endsAt: z.union([z.literal("now"), isoInstantField]) }),
  z.strictObject({ after: z.literal("airing") }),
]);

const reservationParams = idParams.extend({ reservationId: z.string() });

/**
 * Registers reservation HTTP routes; validation lives here and status
 * mapping in `reservation-responses.ts`.
 */
export function registerReservationRoutes(
  server: FastifyInstance,
  reservations: ReservationRepository,
  channels: ChannelRepository,
  schedules: ScheduleService,
  runtime: ChannelRuntime,
): void {
  server.get("/channels/:id/reservations", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    // The repository lists nothing for an unknown channel; the API says so instead.
    if ((await channels.findById(id)) === undefined) {
      return sendChannelNotFound(reply, id);
    }
    const now = schedules.now();
    return (await reservations.listForChannel(id)).map((reservation) =>
      toApiReservation(reservation, now),
    );
  });

  server.post("/channels/:id/reservations", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const result = await applyReservationWrite(
      { schedules, runtime },
      request.log,
      id,
      "reservation_created",
      "created",
      (trx, now) => {
        const { expectedProgrammingRevision, requestKey, ...settings } =
          body.data;
        return reservations.create(
          trx,
          id,
          settings,
          { expectedProgrammingRevision, requestKey },
          now,
        );
      },
    );
    switch (result.kind) {
      case "created":
        return reply
          .status(201)
          .send(toApiReservation(result.reservation, schedules.now()));
      // A retried save answers with what the first one created.
      case "repeated":
        return toApiReservation(result.reservation, schedules.now());
      case "channel_not_found":
        return sendChannelNotFound(reply, id);
      default:
        return sendRefusal(reply, result);
    }
  });

  // What saving the body would air, computed without writing anything.
  server.post("/channels/:id/reservations/preview", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = previewBody.safeParse(request.body);
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
          "The channel cannot generate a schedule",
          {
            channelId: id,
            reason: preview.reason,
            programmingRevision: preview.programmingRevision,
          },
        );
      case "refused": {
        const { status: _, ...conflict } = describeRefusal(preview.refusal);
        return {
          programmingRevision: preview.programmingRevision,
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
      const body = updateBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }
      // Unchanged settings affect no channel, so nothing regenerates.
      const result = await applyReservationWrite(
        { schedules, runtime },
        request.log,
        id,
        "reservation_changed",
        "updated",
        (trx, now) => {
          const { expectedProgrammingRevision, ...settings } = body.data;
          return reservations.update(
            trx,
            id,
            reservationId,
            settings,
            { expectedProgrammingRevision },
            now,
          );
        },
      );
      switch (result.kind) {
        case "updated":
        case "unchanged":
          return toApiReservation(result.reservation, schedules.now());
        case "not_found":
          return sendReservationNotFound(reply, id, reservationId);
        default:
          return sendRefusal(reply, result);
      }
    },
  );

  // Ends a running reservation early, the only change a started one takes.
  server.post(
    "/channels/:id/reservations/:reservationId/end",
    async (request, reply) => {
      const { id, reservationId } = reservationParams.parse(request.params);
      const body = earlyEndBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }
      const result = await applyReservationWrite(
        { schedules, runtime },
        request.log,
        id,
        "reservation_ended_early",
        "ended",
        (trx, now) =>
          reservations.endEarly(trx, id, reservationId, body.data, now),
        { endsEarly: true },
      );
      switch (result.kind) {
        case "ended":
        case "unchanged":
          return toApiReservation(result.reservation, schedules.now());
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
      const result = await applyReservationWrite(
        { schedules, runtime },
        request.log,
        id,
        "reservation_deleted",
        "deleted",
        (trx, now) => reservations.delete(trx, id, reservationId, now),
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
 * Runs one reservation write as a schedule input change that regenerates
 * when the write reports `changedKind`, answering one rolled back for
 * moving the airing filler as that refusal. The channel's worker is told the
 * moment a change commits, before coverage completes, so a cut now reaches
 * the signal at once (ADR 0015).
 */
function applyReservationWrite<T extends { kind: string }>(
  {
    schedules,
    runtime,
  }: { schedules: ScheduleService; runtime: ChannelRuntime },
  log: FastifyBaseLogger,
  channelId: string,
  reason: ScheduleChangeReason,
  changedKind: T["kind"],
  write: (trx: Kysely<DatabaseSchema>, now: number) => Promise<T>,
  options: Parameters<typeof reservationChange>[3] = {},
) {
  return refusingAiringFillerChanges(() =>
    schedules.applyInputChange(
      log,
      reason,
      reservationChange(channelId, changedKind, write, options),
      (value) => {
        if (value.kind === changedKind) {
          notifyScheduleChanged(runtime, channelId, log);
        }
      },
    ),
  );
}

/**
 * Tells the channel's stream worker that a committed reservation write
 * changed its schedule, so a cut reaches the live signal (ADR 0015). A
 * failure is logged and never undoes the commit: the worker still settles
 * the change at its next boundary.
 */
function notifyScheduleChanged(
  runtime: ChannelRuntime,
  channelId: string,
  log: FastifyBaseLogger,
): void {
  try {
    runtime.scheduleChanged(channelId);
  } catch (err) {
    log.warn(
      { channelId, err },
      "Reservation saved but notifying the channel stream worker failed",
    );
  }
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
    "The channel has no such reservation",
    { channelId, reservationId },
  );
}

/** Sends a refusal with the status, code, and words `describeRefusal` gives it. */
function sendRefusal(reply: FastifyReply, refusal: ReservationRefusal) {
  const { status, code, message, ...details } = describeRefusal(refusal);
  return sendApiError(reply, status, code, message, details);
}
