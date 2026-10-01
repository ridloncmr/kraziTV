import { parseChannelNumber, type ChannelNumber } from "@krazitv/krazi-brain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { sendApiError } from "../http/api-error.js";
import type { ChannelRepository } from "./channel-repository.js";
import type { StoredChannel } from "./contracts.js";

// Rejects rather than normalizes, so clients learn the one canonical spelling.
const channelNumber = z.string().transform((input, context) => {
  const parsed = parseChannelNumber(input);
  if (parsed === undefined) {
    context.addIssue({
      code: "custom",
      message: "number must be a canonical channel number such as 69 or 69.1",
    });
    return z.NEVER;
  }
  return parsed;
});

const name = z.string().trim().min(1, "name must not be empty");

const createBody = z.strictObject({
  number: channelNumber,
  name,
  enabled: z.boolean().optional(),
});

const updateBody = z
  .strictObject({
    number: channelNumber.optional(),
    name: name.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "body must change at least one of number, name, or enabled",
  });

const idParams = z.object({ id: z.string() });

/** Registers channel HTTP routes; validation and status mapping live only here. */
export function registerChannelRoutes(
  server: FastifyInstance,
  channels: ChannelRepository,
): void {
  server.get("/channels", async () => {
    const all = await channels.list();
    return all.map(toApiChannel);
  });

  server.post("/channels", async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const result = await channels.create({
      number: body.data.number,
      name: body.data.name,
      enabled: body.data.enabled ?? true,
    });
    if (result.kind === "duplicate_number") {
      return sendDuplicateNumber(reply, result.number);
    }
    return reply.status(201).send(toApiChannel(result.channel));
  });

  server.get("/channels/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const channel = await channels.findById(id);
    if (channel === undefined) {
      return sendChannelNotFound(reply, id);
    }
    return toApiChannel(channel);
  });

  server.patch("/channels/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = updateBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const result = await channels.update(id, body.data);
    if (result.kind === "not_found") {
      return sendChannelNotFound(reply, id);
    }
    if (result.kind === "duplicate_number") {
      return sendDuplicateNumber(reply, result.number);
    }
    return toApiChannel(result.channel);
  });

  // Idempotent: deleting an absent channel succeeds, as the spec requires.
  server.delete("/channels/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await channels.delete(id);
    return reply.status(204).send();
  });
}

// Every body failure shares one code; the message carries Zod's field detail.
function sendInvalidRequest(reply: FastifyReply, error: z.ZodError) {
  return sendApiError(reply, 400, "invalid_request", z.prettifyError(error));
}

// One 404 shape for every channel route.
function sendChannelNotFound(reply: FastifyReply, id: string) {
  return sendApiError(
    reply,
    404,
    "channel_not_found",
    `Channel ${id} does not exist`,
  );
}

// Names the contested number so the client can pick another.
function sendDuplicateNumber(reply: FastifyReply, number: ChannelNumber) {
  return sendApiError(
    reply,
    409,
    "channel_number_duplicate",
    `Channel number ${number} is already in use`,
  );
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
function toApiChannel(channel: StoredChannel) {
  return {
    id: channel.id,
    number: channel.number,
    name: channel.name,
    enabled: channel.enabled,
    createdAt: new Date(channel.createdAt).toISOString(),
    updatedAt: new Date(channel.updatedAt).toISOString(),
  };
}
