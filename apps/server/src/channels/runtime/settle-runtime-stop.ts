import { type ChannelStopReason, SignalError } from "@krazitv/signal";
import type { FastifyBaseLogger } from "fastify";

import type { ChannelRuntime } from "../contracts.js";
import type { ChannelLifecycleLock } from "./channel-lifecycle-lock.js";

/**
 * How long an administrative change waits for a channel's runtime stop. Well
 * above the manager's FFmpeg termination grace plus one escalation, so only a
 * stop that truly hangs is cut off.
 */
export const DEFAULT_CHANNEL_STOP_TIMEOUT_MS = 30_000;

type StopLog = Pick<FastifyBaseLogger, "error">;

/** One administrative stop: the channel, why it stops, and fields its log carries. */
interface RuntimeStop {
  channelId: string;
  reason: ChannelStopReason;
  /** Caller facts logged with a failure, such as the operation that stopped it. */
  context?: Readonly<Record<string, unknown>>;
}

/**
 * Awaits one channel's runtime stop and reports whether it settled before
 * the deadline. A failure, or a stop still running at the deadline, is
 * logged with its cause chain; the caller decides how to answer it. The
 * deadline frees the caller, and the channel's lifecycle lock, while a late
 * outcome is ignored. Returns a boolean because callers hold thenable
 * FastifyReply values that await would swallow.
 */
export async function settleRuntimeStop(
  log: StopLog,
  runtime: ChannelRuntime,
  timeoutMs: number,
  { channelId, reason, context = {} }: RuntimeStop,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Channel ${channelId} runtime stop did not settle within ${timeoutMs} ms`,
          ),
        ),
      timeoutMs,
    );
  });
  const stopping = runtime.stopChannel(channelId, reason);
  // A stop that fails after the deadline has already been answered.
  stopping.catch(() => undefined);
  try {
    await Promise.race([stopping, deadline]);
    return true;
  } catch (error) {
    log.error(
      {
        err: error,
        channelId,
        ...context,
        stopReason: reason,
        ...describeFailure(error),
      },
      "Channel runtime cleanup failed",
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Settles one channel's runtime stop while holding its lifecycle lock, for a
 * change that does not otherwise touch the channel's lifecycle, so the stop
 * never interleaves with a disable, delete, or re-enable of that channel.
 */
export async function stopChannelUnderLock(
  lock: ChannelLifecycleLock,
  runtime: ChannelRuntime,
  timeoutMs: number,
  log: StopLog,
  stop: RuntimeStop,
): Promise<boolean> {
  const release = await lock.acquire(stop.channelId);
  try {
    return await settleRuntimeStop(log, runtime, timeoutMs, stop);
  } finally {
    release();
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
