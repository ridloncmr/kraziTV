import type { FastifyReply } from "fastify";

import {
  sendApiError,
  sendChannelNotFound,
  sendUnknownMediaItems,
} from "../../http/api-error.js";
import type {
  BatchCreateRefusal,
  CreateAssignmentResult,
  MemberAssignedResult,
  UnknownMemberResult,
} from "../contracts.js";

// Maps programming-assignment refusals to their API errors, so every
// assignment route answers the same refusal with the same status and code.

// An assignment owned by another channel is reported the same as a missing one.
export function sendAssignmentNotFound(
  reply: FastifyReply,
  channelId: string,
  assignmentId: string,
) {
  return sendApiError(
    reply,
    404,
    "programming_assignment_not_found",
    "The channel has no such programming assignment",
    { channelId, assignmentId },
  );
}

// A preview or reset names a collection; the assignment must hold it.
export function sendNotAssigned(
  reply: FastifyReply,
  assignmentId: string,
  mediaCollectionId: string,
) {
  return sendApiError(
    reply,
    404,
    "media_collection_not_assigned",
    "The programming assignment does not play that media collection",
    { assignmentId, mediaCollectionId },
  );
}

// A body's unknown reference is a 400, not a 404: the resource itself
// exists. A member another assignment plays is a conflict with it.
// A batch create adds the refused assignment's request index to `details`.
export function sendMemberRefused(
  reply: FastifyReply,
  result: UnknownMemberResult | MemberAssignedResult,
  details: Readonly<Record<string, unknown>> = {},
) {
  if (result.kind === "member_assigned") {
    return sendApiError(
      reply,
      409,
      "programming_member_assigned",
      "Another programming assignment on this channel already plays that member",
      { ...details, member: result.member, assignmentId: result.assignmentId },
    );
  }
  if (result.kind === "unknown_collection") {
    return sendApiError(
      reply,
      400,
      "media_collection_not_found",
      "The media collection does not exist",
      { ...details, mediaCollectionId: result.mediaCollectionId },
    );
  }
  return sendUnknownMediaItems(reply, [result.mediaItemId], details);
}

// Maps each rejected create to its status.
export function sendCreateFailure(
  reply: FastifyReply,
  channelId: string,
  result: Exclude<CreateAssignmentResult, { kind: "created" }>,
) {
  return result.kind === "channel_not_found"
    ? sendChannelNotFound(reply, channelId)
    : sendMemberRefused(reply, result);
}

// Maps a batch refusal to the single create's status, naming its index. A
// member repeated within the request conflicts with the earlier assignment
// as an already-assigned member does with a saved one.
export function sendBatchRefusal(
  reply: FastifyReply,
  channelId: string,
  { index, refusal }: { index: number; refusal: BatchCreateRefusal },
) {
  if (refusal.kind === "channel_not_found") {
    return sendChannelNotFound(reply, channelId);
  }
  if (refusal.kind === "member_repeated") {
    return sendApiError(
      reply,
      409,
      "programming_member_assigned",
      `Assignment ${refusal.assignmentIndex} in this request already plays a member of assignment ${index}`,
      {
        index,
        member: refusal.member,
        assignmentIndex: refusal.assignmentIndex,
      },
    );
  }
  return sendMemberRefused(reply, refusal, { index });
}
