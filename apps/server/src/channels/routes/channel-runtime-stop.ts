import type { FastifyReply, FastifyRequest } from "fastify";

import { sendApiError } from "../../http/api-error.js";
import type { ChannelRuntime } from "../contracts.js";
import { settleRuntimeStop } from "../runtime/settle-runtime-stop.js";

type RuntimeStop = {
  channelId: string;
  operation: "disable" | "delete";
  /** Whether the configuration change was saved before this stop ran. */
  persistenceCommitted: boolean;
};

/**
 * Awaits the runtime stop a disable or delete requires and reports whether
 * it settled. A stop that failed or missed its deadline is answered with the
 * retryable cleanup error, so the route must end without sending;
 * persistence is never rolled back. A re-enable therefore commits only after
 * a stop that settled within its own request.
 */
export async function stopRuntime(
  request: FastifyRequest,
  reply: FastifyReply,
  runtime: ChannelRuntime,
  timeoutMs: number,
  stop: RuntimeStop,
): Promise<boolean> {
  const settled = await settleRuntimeStop(request.log, runtime, timeoutMs, {
    channelId: stop.channelId,
    reason: stop.operation === "disable" ? "disabled" : "deleted",
    context: stop,
  });
  if (!settled) {
    sendApiError(
      reply,
      503,
      "channel_runtime_cleanup_failed",
      cleanupFailedMessage(stop),
      { ...stop, retryable: true },
    );
  }
  return settled;
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
