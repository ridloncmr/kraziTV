import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  sendApiError,
  sendChannelNotFound,
  sendInvalidRequest,
} from "../../http/api-error.js";
import { toApiTimestamp } from "../../http/api-timestamp.js";
import { parseChannelNumber, type ChannelNumber } from "../channel-number.js";
import { idParams, nameField } from "../../http/request-schemas.js";
import { ChannelLifecycleLock } from "./channel-lifecycle-lock.js";
import type { ChannelRepository } from "../repository/channel-repository.js";
import { stopRuntime } from "./channel-runtime-stop.js";
import type { ChannelRuntime, StoredChannel } from "../contracts.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";

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

const createBody = z.strictObject({
  number: channelNumber,
  name: nameField,
  enabled: z.boolean().optional(),
});

const updateBody = z
  .strictObject({
    number: channelNumber.optional(),
    name: nameField.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "body must change at least one of number, name, or enabled",
  });

// Well above the manager's FFmpeg termination grace plus one escalation, so
// only a stop that truly hangs is cut off.
const DEFAULT_STOP_TIMEOUT_MS = 30_000;

/** Registers channel HTTP routes; validation and status mapping live only here. */
export function registerChannelRoutes(
  server: FastifyInstance,
  channels: ChannelRepository,
  runtime: ChannelRuntime,
  schedules: ScheduleService,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
): void {
  // Every PATCH and DELETE takes it, so a rename cannot slip between a
  // re-enable's stop and its commit either; uncontended waits are one tick.
  const lifecycle = new ChannelLifecycleLock();
  // Every lifecycle change stops the same runtime under the same deadline.
  const settleStop = (
    request: FastifyRequest,
    reply: FastifyReply,
    stop: Parameters<typeof stopRuntime>[4],
  ) => stopRuntime(request, reply, runtime, stopTimeoutMs, stop);

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

    const release = await lifecycle.acquire(id);
    try {
      // Nothing records whether a disabled channel's last stop settled, so every
      // re-enable retries it first; the old runtime must never outlive the enable.
      if (body.data.enabled === true) {
        const current = await channels.findById(id);
        if (current === undefined) {
          return sendChannelNotFound(reply, id);
        }
        if (!current.enabled) {
          const settled = await settleStop(request, reply, {
            channelId: id,
            operation: "disable",
            persistenceCommitted: false,
          });
          if (!settled) return reply;
        }
      }

      const result = await channels.update(id, body.data);
      if (result.kind === "not_found") {
        return sendChannelNotFound(reply, id);
      }
      if (result.kind === "duplicate_number") {
        return sendDuplicateNumber(reply, result.number);
      }

      // Stops even when the channel was already disabled, so a disable retries cleanup.
      if (body.data.enabled === false) {
        const settled = await settleStop(request, reply, {
          channelId: id,
          operation: "disable",
          persistenceCommitted: true,
        });
        if (!settled) return reply;
      }

      // Repairs a schedule that lapsed while disabled, or extends one that
      // did not. Logged, not returned: the enable is already committed, and
      // the next ensure retries.
      if (body.data.enabled === true) {
        try {
          await schedules.ensureCoverage(id, request.log);
        } catch (err) {
          request.log.warn(
            { channelId: id, err },
            "Channel enabled but ensuring schedule coverage failed",
          );
        }
      }
      return toApiChannel(result.channel);
    } finally {
      release();
    }
  });

  // Idempotent: deleting an absent channel still stops its runtime and succeeds,
  // which is how a client retries a failed cleanup.
  server.delete("/channels/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const release = await lifecycle.acquire(id);
    try {
      await channels.delete(id);
      const settled = await settleStop(request, reply, {
        channelId: id,
        operation: "delete",
        persistenceCommitted: true,
      });
      if (!settled) return reply;
      return reply.status(204).send();
    } finally {
      release();
    }
  });
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
    createdAt: toApiTimestamp(channel.createdAt),
    updatedAt: toApiTimestamp(channel.updatedAt),
  };
}
