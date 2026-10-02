import { SignalError } from "@krazitv/signal";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendApiError } from "../../http/api-error.js";
import type { ChannelRuntime } from "../contracts.js";

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
export async function stopRuntime(
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
