import {
  ASSIGNMENT_PARTICIPATIONS,
  describeOrderedView,
  findStretchProblem,
  type OrderedMember,
  PLAYBACK_MODES,
} from "@krazitv/krazi-brain";
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
import { idParams, stretchField } from "../../http/request-schemas.js";
import type { ScheduleEntry } from "../../schedules/contracts.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import { channelInputChange } from "../../schedules/channel-input-change.js";
import type { AssignmentRepository } from "../persistence/assignment-repository.js";
import type {
  CreateAssignmentResult,
  MemberAssignedResult,
  SourceAssignment,
  UnknownMemberResult,
} from "../contracts.js";
import { resetCollectionProgress } from "../writes/progress-reset.js";

// Strict members reject a doubled source and unknown fields.
const member = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("collection"),
    mediaCollectionId: z.string(),
  }),
  z.strictObject({ kind: z.literal("media_item"), mediaItemId: z.string() }),
]);

// Create and PATCH share one body: PATCH replaces the whole assignment,
// members in saved order. A collection needs a playback mode; single items
// alone take none. Each member appears once.
const settingsBody = z
  .strictObject({
    // Omitted means the assignment rotates normally.
    participation: z.enum(ASSIGNMENT_PARTICIPATIONS).default("default"),
    playbackMode: z.enum(PLAYBACK_MODES).nullable(),
    ordinaryStretch: stretchField,
    // Omitted means marathons are disabled for the assignment.
    marathonStretch: stretchField.nullable().default(null),
    members: z
      .array(member)
      .min(1)
      .refine(
        (members) =>
          new Set(members.map((entry) => JSON.stringify(entry))).size ===
          members.length,
        { message: "members must not repeat a collection or item" },
      ),
  })
  .superRefine((body, context) => {
    const problem = findStretchProblem(
      body.ordinaryStretch,
      body.marathonStretch,
    );
    if (problem !== null) {
      context.addIssue({ code: "custom", message: problem });
    }
  })
  .refine(
    (body) =>
      (body.playbackMode !== null) ===
      body.members.some((entry) => entry.kind === "collection"),
    {
      message:
        "playbackMode is required with a collection and absent without one",
      path: ["playbackMode"],
    },
  );

const assignmentParams = z.object({ id: z.string(), assignmentId: z.string() });

// Comma-separated ID lists, so the editor can refetch as members change.
const idList = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(",") : []));
const suggestionQuery = z
  .strictObject({ mediaCollectionIds: idList, mediaItemIds: idList })
  .refine(
    (query) => query.mediaCollectionIds.length + query.mediaItemIds.length > 0,
    { message: "name at least one collection or item" },
  );

// Names the assigned collection; omitting the mode previews the saved one.
const previewQuery = z.strictObject({
  mediaCollectionId: z.string(),
  playbackMode: z.enum(PLAYBACK_MODES).optional(),
});

const resetBody = z.strictObject({ mediaCollectionId: z.string() });

const orderBody = z.strictObject({ assignmentIds: z.array(z.string()) });

/** Registers programming-assignment HTTP routes; validation and status mapping live only here. */
export function registerAssignmentRoutes(
  server: FastifyInstance,
  assignments: AssignmentRepository,
  channels: ChannelRepository,
  schedules: ScheduleService,
): void {
  server.get(
    "/channels/:id/programming-assignments",
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      // The repository lists nothing for an unknown channel; the API says so instead.
      if ((await channels.findById(id)) === undefined) {
        return sendChannelNotFound(reply, id);
      }
      const listed = await assignments.listForChannel(id);
      return listed.map(toApiAssignment);
    },
  );

  // Suggests a new assignment's ordinary stretch from its members' content
  // types; the editor applies it as an editable default and asks when the
  // answer is null. Reads only.
  server.get(
    "/programming-assignments/stretch-suggestion",
    async (request, reply) => {
      const query = suggestionQuery.safeParse(request.query);
      if (!query.success) {
        return sendInvalidRequest(reply, query.error);
      }
      return {
        ordinaryStretch: await assignments.suggestStretch([
          ...query.data.mediaCollectionIds.map((mediaCollectionId) => ({
            kind: "collection" as const,
            mediaCollectionId,
          })),
          ...query.data.mediaItemIds.map((mediaItemId) => ({
            kind: "media_item" as const,
            mediaItemId,
          })),
        ]),
      };
    },
  );

  server.post(
    "/channels/:id/programming-assignments",
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const body = settingsBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }

      const result = await schedules.applyInputChange(
        request.log,
        "assignment_created",
        channelInputChange(id, "created", (trx, now) =>
          assignments.create(trx, id, body.data, now),
        ),
      );
      if (result.kind !== "created") {
        return sendCreateFailure(reply, id, result);
      }
      return reply.status(201).send(toApiAssignment(result.assignment));
    },
  );

  server.patch(
    "/channels/:id/programming-assignments/:assignmentId",
    async (request, reply) => {
      const { id, assignmentId } = assignmentParams.parse(request.params);
      const body = settingsBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }

      // Unchanged settings affect no channel, so nothing regenerates.
      const result = await schedules.applyInputChange(
        request.log,
        "assignment_changed",
        channelInputChange(id, "updated", (trx, now) =>
          assignments.update(trx, id, assignmentId, body.data, now),
        ),
      );
      switch (result.kind) {
        case "updated":
        case "unchanged":
          return toApiAssignment(result.assignment);
        case "not_found":
          return sendAssignmentNotFound(reply, id, assignmentId);
        case "rule_stretch_conflict":
          return sendApiError(
            reply,
            409,
            "programming_rule_stretch_conflict",
            `Rule "${result.ruleName}" inherits this assignment's marathon, which would become invalid: ${result.problem}. Replace or disable the rule's marathon first.`,
            { ruleId: result.ruleId, problem: result.problem },
          );
        default:
          return sendMemberRefused(reply, result);
      }
    },
  );

  // Saves the order future rounds are formed in; the current round's
  // pending turns stand, so a reorder grants no assignment another turn.
  server.put(
    "/channels/:id/programming-assignments/order",
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const body = orderBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }
      const result = await schedules.applyInputChange(
        request.log,
        "assignments_reordered",
        channelInputChange(id, "reordered", (trx, now) =>
          assignments.reorder(trx, id, body.data.assignmentIds, now),
        ),
      );
      switch (result.kind) {
        case "reordered":
        case "unchanged":
          return result.assignments.map(toApiAssignment);
        case "channel_not_found":
          return sendChannelNotFound(reply, id);
        default:
          return sendApiError(
            reply,
            409,
            "programming_assignment_order_mismatch",
            `The order must name each of channel ${id}'s assignments once`,
            { assignmentIds: result.assignmentIds },
          );
      }
    },
  );

  // Reads only: the preview explains an assigned collection's order in its
  // saved or a proposed mode and never generates. Upcoming selections exist
  // only for the saved mode.
  server.get(
    "/channels/:id/programming-assignments/:assignmentId/preview",
    async (request, reply) => {
      const { id, assignmentId } = assignmentParams.parse(request.params);
      const query = previewQuery.safeParse(request.query);
      if (!query.success) {
        return sendInvalidRequest(reply, query.error);
      }
      const { mediaCollectionId } = query.data;
      const preview = await schedules.readCollectionPreview(
        id,
        assignmentId,
        mediaCollectionId,
      );
      if (preview === undefined) {
        return sendNotAssigned(reply, assignmentId, mediaCollectionId);
      }
      const playbackMode = query.data.playbackMode ?? preview.playbackMode;
      return {
        playbackMode,
        ordered:
          describeOrderedView(preview.members, playbackMode)?.map(
            toApiOrderedMember,
          ) ?? null,
        upcoming:
          playbackMode === preview.playbackMode
            ? preview.upcoming.map(toApiUpcomingEntry)
            : null,
      };
    },
  );

  // Restarts one assigned collection in the assignment's mode and
  // regenerates after the airing entry; the browser confirms first.
  server.post(
    "/channels/:id/programming-assignments/:assignmentId/progress-reset",
    async (request, reply) => {
      const { id, assignmentId } = assignmentParams.parse(request.params);
      const body = resetBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }
      const { mediaCollectionId } = body.data;
      const result = await schedules.applyInputChange(
        request.log,
        "progress_reset",
        channelInputChange(id, "reset", (trx, now) =>
          resetCollectionProgress(
            trx,
            { channelId: id, assignmentId, mediaCollectionId },
            now,
          ),
        ),
      );
      if (result.kind === "not_assigned") {
        return sendNotAssigned(reply, assignmentId, mediaCollectionId);
      }
      return reply.status(204).send();
    },
  );

  server.delete(
    "/channels/:id/programming-assignments/:assignmentId",
    async (request, reply) => {
      const { id, assignmentId } = assignmentParams.parse(request.params);
      const result = await schedules.applyInputChange(
        request.log,
        "assignment_deleted",
        channelInputChange(id, "deleted", (trx) =>
          assignments.delete(trx, id, assignmentId),
        ),
      );
      if (result.kind === "not_found") {
        return sendAssignmentNotFound(reply, id, assignmentId);
      }
      return reply.status(204).send();
    },
  );
}

// An assignment owned by another channel is reported the same as a missing one.
function sendAssignmentNotFound(
  reply: FastifyReply,
  channelId: string,
  assignmentId: string,
) {
  return sendApiError(
    reply,
    404,
    "programming_assignment_not_found",
    `Channel ${channelId} has no programming assignment ${assignmentId}`,
  );
}

// A preview or reset names a collection; the assignment must hold it.
function sendNotAssigned(
  reply: FastifyReply,
  assignmentId: string,
  mediaCollectionId: string,
) {
  return sendApiError(
    reply,
    404,
    "media_collection_not_assigned",
    `Programming assignment ${assignmentId} on this channel does not play media collection ${mediaCollectionId}`,
  );
}

// A body's unknown reference is a 400, not a 404: the resource itself
// exists. A member another assignment plays is a conflict with it.
function sendMemberRefused(
  reply: FastifyReply,
  result: UnknownMemberResult | MemberAssignedResult,
) {
  if (result.kind === "member_assigned") {
    return sendApiError(
      reply,
      409,
      "programming_member_assigned",
      `Programming assignment ${result.assignmentId} on this channel already plays that member`,
      { member: result.member, assignmentId: result.assignmentId },
    );
  }
  if (result.kind === "unknown_collection") {
    return sendApiError(
      reply,
      400,
      "media_collection_not_found",
      `Media collection ${result.mediaCollectionId} does not exist`,
    );
  }
  return sendUnknownMediaItems(reply, [result.mediaItemId]);
}

// Maps each rejected create to its status.
function sendCreateFailure(
  reply: FastifyReply,
  channelId: string,
  result: Exclude<CreateAssignmentResult, { kind: "created" }>,
) {
  return result.kind === "channel_not_found"
    ? sendChannelNotFound(reply, channelId)
    : sendMemberRefused(reply, result);
}

// Shows a member with the facts its place rests on and the preview's flags.
function toApiOrderedMember({
  media,
  unresolved,
  startsSeriesGroup,
  duplicateEpisode,
}: OrderedMember) {
  return {
    mediaItemId: media.id,
    title: media.title,
    status: media.status,
    seriesName: media.seriesName,
    seasonNumber: media.seasonNumber,
    episodeNumber: media.episodeNumber,
    releaseDate: media.releaseDate,
    unresolved,
    startsSeriesGroup,
    duplicateEpisode,
  };
}

// Shows one upcoming selection with ISO 8601 times.
function toApiUpcomingEntry(entry: ScheduleEntry) {
  return {
    id: entry.id,
    mediaItemId: entry.mediaItemId,
    title: entry.title,
    startsAt: toApiTimestamp(entry.startsAt),
    endsAt: toApiTimestamp(entry.endsAt),
  };
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
function toApiAssignment(assignment: SourceAssignment) {
  return {
    id: assignment.id,
    channelId: assignment.channelId,
    participation: assignment.participation,
    playbackMode: assignment.playbackMode,
    ordinaryStretch: assignment.ordinaryStretch,
    marathonStretch: assignment.marathonStretch,
    members: assignment.members,
    createdAt: toApiTimestamp(assignment.createdAt),
    updatedAt: toApiTimestamp(assignment.updatedAt),
  };
}
