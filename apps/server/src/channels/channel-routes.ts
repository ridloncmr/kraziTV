import { parseChannelNumber, type ChannelNumber } from "@krazitv/krazi-brain";
import { SignalError } from "@krazitv/signal";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { sendApiError } from "../http/api-error.js";
import { ChannelLifecycleLock } from "./channel-lifecycle-lock.js";
import type { ChannelRepository } from "./channel-repository.js";
import type { ChannelRuntime, StoredChannel } from "./contracts.js";

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

// Well above the manager's FFmpeg termination grace plus one escalation, so
// only a stop that truly hangs is cut off.
const DEFAULT_STOP_TIMEOUT_MS = 30_000;

/** Registers channel HTTP routes; validation and status mapping live only here. */
export function registerChannelRoutes(
  server: FastifyInstance,
  channels: ChannelRepository,
  runtime: ChannelRuntime,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
): void {
  // Every PATCH and DELETE takes it, so a rename cannot slip between a
  // re-enable's stop and its commit either; uncontended waits are one tick.
  const lifecycle = new ChannelLifecycleLock();

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
          const settled = await stopRuntime(
            request,
            reply,
            runtime,
            stopTimeoutMs,
            {
              channelId: id,
              operation: "disable",
              persistenceCommitted: false,
            },
          );
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
        const settled = await stopRuntime(
          request,
          reply,
          runtime,
          stopTimeoutMs,
          {
            channelId: id,
            operation: "disable",
            persistenceCommitted: true,
          },
        );
        if (!settled) return reply;
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
      const settled = await stopRuntime(
        request,
        reply,
        runtime,
        stopTimeoutMs,
        {
          channelId: id,
          operation: "delete",
          persistenceCommitted: true,
        },
      );
      if (!settled) return reply;
      return reply.status(204).send();
    } finally {
      release();
    }
  });
}

type RuntimeStop = {
  channelId: string;
  operation: "disable" | "delete";
  /** Whether the configuration change was saved before this stop ran. */
  persistenceCommitted: boolean;
};

/**
 * Awaits the runtime stop an administrative change requires and reports
 * whether it settled. A failure, or a stop still running at the deadline, is
 * logged and answered with the retryable cleanup error, so the route must end
 * without sending; persistence is never rolled back. The deadline frees the
 * channel's lifecycle lock; a late success is ignored, so a re-enable still
 * commits only after a stop that settled within its own request. Returns a
 * boolean because FastifyReply is thenable and would be swallowed by await.
 */
async function stopRuntime(
  request: FastifyRequest,
  reply: FastifyReply,
  runtime: ChannelRuntime,
  timeoutMs: number,
  stop: RuntimeStop,
): Promise<boolean> {
  const reason = stop.operation === "disable" ? "disabled" : "deleted";
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Channel ${stop.channelId} runtime stop did not settle within ${timeoutMs} ms`,
          ),
        ),
      timeoutMs,
    );
  });
  const stopping = runtime.stopChannel(stop.channelId, reason);
  // A stop that fails after the deadline has already been answered.
  stopping.catch(() => undefined);
  try {
    await Promise.race([stopping, deadline]);
    return true;
  } catch (error) {
    request.log.error(
      { err: error, ...stop, stopReason: reason, ...describeFailure(error) },
      "Channel runtime cleanup failed",
    );
    sendApiError(
      reply,
      503,
      "channel_runtime_cleanup_failed",
      cleanupFailedMessage(stop),
      { ...stop, retryable: true },
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Flattens a runtime failure's cause chain into loggable entries. The default
 * error serializer keeps only cause messages, but operators need each cause's
 * typed details, such as the cleanup phase and FFmpeg process information.
 */
function describeFailure(error: unknown): {
  cleanupPhase: unknown;
  causes: Array<{ code?: string; message: string; details?: unknown }>;
} {
  const causes = [];
  let cleanupPhase: unknown;
  // Bounded so a cyclic cause chain cannot hang the error path.
  for (
    let current: unknown = error;
    current instanceof Error && causes.length < 8;
    current = current.cause
  ) {
    if (current instanceof SignalError) {
      cleanupPhase ??= current.details.phase;
      causes.push({
        code: current.code,
        message: current.message,
        details: current.details,
      });
    } else {
      causes.push({ message: current.message });
    }
  }
  return { cleanupPhase, causes };
}

// Tells the client whether the change already saved, so a retry is understood
// as finishing cleanup rather than repeating or reversing the change.
function cleanupFailedMessage(stop: RuntimeStop): string {
  if (!stop.persistenceCommitted) {
    return `Channel ${stop.channelId} stays disabled because its earlier runtime cleanup did not finish; retry to finish cleanup before enabling`;
  }
  const change = stop.operation === "disable" ? "disabled" : "deleted";
  return `Channel ${stop.channelId} was ${change}, but its runtime cleanup did not finish; retry the ${stop.operation} to finish cleanup`;
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
