import {
  ASSIGNMENT_PARTICIPATIONS,
  describeOrderedView,
  findStretchProblem,
  type OrderedMember,
  PLAYBACK_MODES,
} from "@krazitv/krazi-brain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ChannelRepository } from "../../channels/repository/channel-repository.js";
import {
  sendApiError,
  sendChannelNotFound,
  sendInvalidRequest,
} from "../../http/api-error.js";
import { toApiTimestamp } from "../../http/api-timestamp.js";
import { idParams, stretchField } from "../../http/request-schemas.js";
import type { ScheduleEntry } from "../../schedules/contracts.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import {
  channelInputChange,
  configurationChange,
} from "../../schedules/channel-input-change.js";
import type { AssignmentRepository } from "../persistence/assignment-repository.js";
import type { SourceAssignment } from "../contracts.js";
import { BatchCreateRefusedError } from "../writes/batch-create-refused-error.js";
import { createAssignments } from "../writes/create-assignments.js";
import { resetCollectionProgress } from "../writes/progress-reset.js";
import {
  sendAssignmentNotFound,
  sendBatchRefusal,
  sendCreateFailure,
  sendMemberRefused,
  sendNotAssigned,
} from "./assignment-refusals.js";

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

// Zod paths name a failing assignment's index, as `assignments[1]`.
const batchBody = z.strictObject({
  assignments: z.array(settingsBody).min(1),
});

const assignmentParams = idParams.extend({ assignmentId: z.string() });

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
  // types, with the content kind it rests on; the editor applies it as an
  // editable default, labels presets by the kind, and asks when the answer
  // is null. Reads only.
  server.get(
    "/programming-assignments/stretch-suggestion",
    async (request, reply) => {
      const query = suggestionQuery.safeParse(request.query);
      if (!query.success) {
        return sendInvalidRequest(reply, query.error);
      }
      return assignments.suggestStretch([
        ...query.data.mediaCollectionIds.map((mediaCollectionId) => ({
          kind: "collection" as const,
          mediaCollectionId,
        })),
        ...query.data.mediaItemIds.map((mediaItemId) => ({
          kind: "media_item" as const,
          mediaItemId,
        })),
      ]);
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
        configurationChange(id, "created", (trx, now) =>
          assignments.create(trx, id, body.data, now),
        ),
      );
      if (result.kind !== "created") {
        return sendCreateFailure(reply, id, result);
      }
      return reply.status(201).send(toApiAssignment(result.assignment));
    },
  );

  // Adds several shows at once (programming spec 0008): every assignment
  // or none, with one regeneration and one revision step. A refusal names
  // the refused assignment's request index.
  server.post(
    "/channels/:id/programming-assignments/batch",
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const body = batchBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }

      try {
        const result = await schedules.applyInputChange(
          request.log,
          "assignment_created",
          configurationChange(id, "created", (trx, now) =>
            createAssignments(assignments, trx, id, body.data.assignments, now),
          ),
        );
        return reply.status(201).send(result.assignments.map(toApiAssignment));
      } catch (error) {
        if (!(error instanceof BatchCreateRefusedError)) throw error;
        return sendBatchRefusal(reply, id, error);
      }
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
        configurationChange(id, "updated", (trx, now) =>
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
            `Rule "${result.ruleName}" inherits this assignment's settings, and its settings for it would become invalid: ${result.problem}. Change the rule first.`,
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
        configurationChange(id, "reordered", (trx, now) =>
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
        configurationChange(id, "deleted", (trx) =>
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
