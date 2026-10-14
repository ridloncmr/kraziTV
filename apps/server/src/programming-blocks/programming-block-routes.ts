import {
  describeOrderedView,
  type OrderedMember,
  PLAYBACK_MODES,
} from "@krazitv/krazi-brain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { ChannelRepository } from "../channels/repository/channel-repository.js";
import {
  sendApiError,
  sendChannelNotFound,
  sendInvalidRequest,
  sendUnknownMediaItems,
} from "../http/api-error.js";
import { toApiTimestamp } from "../http/api-timestamp.js";
import { idParams } from "../http/request-schemas.js";
import type { ScheduleEntry } from "../schedules/contracts.js";
import type { ScheduleService } from "../schedules/schedule-service.js";
import { blockChange } from "./block-change.js";
import type {
  CreateProgrammingBlockResult,
  ProgrammingBlock,
  UnknownSourceResult,
} from "./contracts.js";
import type { ProgrammingBlockRepository } from "./programming-block-repository.js";

// Strict members reject a doubled source, a mode on an item, and unknown fields.
const source = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("collection"),
    mediaCollectionId: z.string(),
    playbackMode: z.enum(PLAYBACK_MODES),
  }),
  z.strictObject({
    kind: z.literal("media_item"),
    mediaItemId: z.string(),
  }),
]);

// Create and PATCH share one body: PATCH replaces the whole source.
const createBody = z.strictObject({ source });

const blockParams = z.object({ id: z.string(), blockId: z.string() });

// Omitting the mode previews the block's saved one.
const previewQuery = z.object({
  playbackMode: z.enum(PLAYBACK_MODES).optional(),
});

/** Registers programming-block HTTP routes; validation and status mapping live only here. */
export function registerProgrammingBlockRoutes(
  server: FastifyInstance,
  programmingBlocks: ProgrammingBlockRepository,
  channels: ChannelRepository,
  schedules: ScheduleService,
): void {
  server.get("/channels/:id/programming-blocks", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    // The repository lists nothing for an unknown channel; the API says so instead.
    if ((await channels.findById(id)) === undefined) {
      return sendChannelNotFound(reply, id);
    }
    const blocks = await programmingBlocks.listForChannel(id);
    return blocks.map(toApiProgrammingBlock);
  });

  server.post("/channels/:id/programming-blocks", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const result = await schedules.applyInputChange(
      request.log,
      "block_created",
      blockChange(id, "created", (trx, now) =>
        programmingBlocks.create(trx, id, body.data.source, now),
      ),
    );
    if (result.kind !== "created") {
      return sendCreateFailure(reply, id, result);
    }
    return reply.status(201).send(toApiProgrammingBlock(result.block));
  });

  server.patch(
    "/channels/:id/programming-blocks/:blockId",
    async (request, reply) => {
      const { id, blockId } = blockParams.parse(request.params);
      const body = createBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }

      // An unchanged source affects no channel, so nothing regenerates.
      const result = await schedules.applyInputChange(
        request.log,
        "block_changed",
        blockChange(id, "replaced", (trx, now) =>
          programmingBlocks.replaceSource(
            trx,
            id,
            blockId,
            body.data.source,
            now,
          ),
        ),
      );
      switch (result.kind) {
        case "replaced":
        case "unchanged":
          return toApiProgrammingBlock(result.block);
        case "not_found":
          return sendBlockNotFound(reply, id, blockId);
        default:
          return sendUnknownSource(reply, result);
      }
    },
  );

  // Reads only: the preview explains the saved or a proposed mode's order
  // and never generates. Upcoming selections exist only for the saved mode.
  server.get(
    "/channels/:id/programming-blocks/:blockId/preview",
    async (request, reply) => {
      const { id, blockId } = blockParams.parse(request.params);
      const query = previewQuery.safeParse(request.query);
      if (!query.success) {
        return sendInvalidRequest(reply, query.error);
      }
      const preview = await schedules.readBlockPreview(id, blockId);
      if (preview === undefined) {
        return sendBlockNotFound(reply, id, blockId);
      }
      const { source, upcoming } = preview;
      if (source.kind !== "collection") {
        return sendApiError(
          reply,
          409,
          "programming_block_has_no_order",
          `Programming block ${blockId} plays a single item`,
        );
      }
      const playbackMode = query.data.playbackMode ?? source.playbackMode;
      return {
        playbackMode,
        ordered:
          describeOrderedView(source.members, playbackMode)?.map(
            toApiOrderedMember,
          ) ?? null,
        upcoming:
          playbackMode === source.playbackMode
            ? upcoming.map(toApiUpcomingEntry)
            : null,
      };
    },
  );

  server.delete(
    "/channels/:id/programming-blocks/:blockId",
    async (request, reply) => {
      const { id, blockId } = blockParams.parse(request.params);
      const result = await schedules.applyInputChange(
        request.log,
        "block_deleted",
        blockChange(id, "deleted", (trx) =>
          programmingBlocks.delete(trx, id, blockId),
        ),
      );
      if (result.kind === "not_found") {
        return sendBlockNotFound(reply, id, blockId);
      }
      return reply.status(204).send();
    },
  );
}

// A block owned by another channel is reported the same as a missing one.
function sendBlockNotFound(
  reply: FastifyReply,
  channelId: string,
  blockId: string,
) {
  return sendApiError(
    reply,
    404,
    "programming_block_not_found",
    `Channel ${channelId} has no programming block ${blockId}`,
  );
}

// A body's unknown reference is a 400, not a 404: the resource itself exists.
function sendUnknownSource(reply: FastifyReply, result: UnknownSourceResult) {
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
  result: Exclude<CreateProgrammingBlockResult, { kind: "created" }>,
) {
  switch (result.kind) {
    case "channel_not_found":
      return sendChannelNotFound(reply, channelId);
    case "limit_reached":
      return sendApiError(
        reply,
        409,
        "programming_block_limit_reached",
        `Channel ${channelId} already has a programming block`,
      );
    default:
      return sendUnknownSource(reply, result);
  }
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
function toApiProgrammingBlock(block: ProgrammingBlock) {
  return {
    id: block.id,
    channelId: block.channelId,
    source: block.source,
    createdAt: toApiTimestamp(block.createdAt),
    updatedAt: toApiTimestamp(block.updatedAt),
  };
}
