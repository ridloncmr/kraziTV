import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { ChannelRepository } from "../channels/repository/channel-repository.js";
import { sendChannelNotFound } from "../channels/routes/channel-routes.js";
import { sendApiError, sendInvalidRequest } from "../http/api-error.js";
import { toApiTimestamp } from "../http/api-timestamp.js";
import { idParams } from "../http/request-schemas.js";
import { sendUnknownMediaItems } from "../media-collections/media-collection-routes.js";
import type { ScheduleService } from "../schedules/schedule-service.js";
import type {
  CreateProgrammingBlockResult,
  ProgrammingBlock,
} from "./contracts.js";
import type { ProgrammingBlockRepository } from "./programming-block-repository.js";

// Strict members reject a doubled source, a mode on an item, and unknown fields.
const source = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("collection"),
    mediaCollectionId: z.string(),
    playbackMode: z.enum(["chronological", "random"]),
  }),
  z.strictObject({
    kind: z.literal("media_item"),
    mediaItemId: z.string(),
  }),
]);

const createBody = z.strictObject({ source });

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
      async (trx, now) => {
        const created = await programmingBlocks.create(
          trx,
          id,
          body.data.source,
          now,
        );
        return {
          value: created,
          affectedChannelIds: created.kind === "created" ? [id] : [],
        };
      },
    );
    if (result.kind !== "created") {
      return sendCreateFailure(reply, id, result);
    }
    return reply.status(201).send(toApiProgrammingBlock(result.block));
  });
}

// Maps each rejected create to its status; a body's unknown reference is a 400, not a 404.
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
    case "unknown_collection":
      return sendApiError(
        reply,
        400,
        "media_collection_not_found",
        `Media collection ${result.mediaCollectionId} does not exist`,
      );
    case "unknown_media_item":
      return sendUnknownMediaItems(reply, [result.mediaItemId]);
  }
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
