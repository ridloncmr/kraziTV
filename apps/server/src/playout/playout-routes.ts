import type { ChannelState, PlayoutItem } from "@krazitv/krazi-brain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  sendApiError,
  sendChannelDisabled,
  sendChannelNotFound,
  sendInvalidRequest,
  sendScheduleBusy,
} from "../http/api-error.js";
import { toApiTimestamp } from "../http/api-timestamp.js";
import { idParams, isoInstantField } from "../http/request-schemas.js";
import type { PlayoutFailure } from "./contracts.js";
import type { PlayoutService } from "./playout-service.js";

// Production callers omit `at`; tests and debugging pin the evaluation time.
const nowQuery = z.strictObject({ at: isoInstantField.optional() });

/** Registers playout HTTP routes; validation and status mapping live only here. */
export function registerPlayoutRoutes(
  server: FastifyInstance,
  playout: PlayoutService,
): void {
  server.get("/channels/:id/now", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const query = nowQuery.safeParse(request.query);
    if (!query.success) {
      return sendInvalidRequest(reply, query.error);
    }

    const state = await playout.getCurrent(id, query.data.at, request.log);
    if (state.kind !== "current" && state.kind !== "no_current") {
      return sendPlayoutFailure(reply, id, state);
    }
    return toApiChannelState(state);
  });
}

// Maps each playout failure to its status; a busy writer thrown by the
// coverage write is mapped by the shared error handler instead.
function sendPlayoutFailure(
  reply: FastifyReply,
  channelId: string,
  failure: PlayoutFailure,
) {
  switch (failure.kind) {
    case "not_found":
      return sendChannelNotFound(reply, channelId);
    case "disabled":
      return sendChannelDisabled(reply, channelId);
    case "through_out_of_range":
      return sendApiError(
        reply,
        400,
        "invalid_request",
        `at must not be after ${toApiTimestamp(failure.latestThrough)}`,
      );
    case "unavailable":
      return sendScheduleBusy(reply);
  }
}

// Builds the public shape field by field, so internal packaging inputs such
// as the media path and audio fact can never leak into a response.
function toApiChannelState(state: ChannelState) {
  const base = {
    channelId: state.channelId,
    scheduleRevision: state.scheduleRevision,
    evaluatedAt: toApiTimestamp(state.evaluatedAt),
  };
  if (state.kind === "current") {
    return {
      ...base,
      currentItem: {
        ...toApiPlayoutItem(state.currentItem),
        offsetMs: state.currentItem.offsetMs,
      },
      nextItem: state.nextItem && toApiPlayoutItem(state.nextItem),
    };
  }
  return {
    ...base,
    currentItem: null,
    nextItem: null,
    reason: state.reason,
    ...(state.reason === "media_unavailable"
      ? { scheduleEntryId: state.scheduleEntryId }
      : {}),
  };
}

// Converts one item's instants; durations and offsets stay in milliseconds.
function toApiPlayoutItem(item: PlayoutItem) {
  return {
    type: item.type,
    scheduleEntryId: item.scheduleEntryId,
    mediaItemId: item.mediaItemId,
    title: item.title,
    startsAt: toApiTimestamp(item.startsAt),
    endsAt: toApiTimestamp(item.endsAt),
    durationMs: item.durationMs,
    startOffsetMs: item.startOffsetMs,
    createdAt: toApiTimestamp(item.createdAt),
    updatedAt: toApiTimestamp(item.updatedAt),
  };
}
