import type { ChannelAuthorizationResult } from "../channel-worker/contracts.js";
import { SignalError } from "../errors.js";
import type { ChannelId } from "../playout/contracts.js";
import type { ChannelStopReason } from "./contracts.js";

/** Which cleanup step left a channel's runtime unsettled; logged by callers. */
export type CleanupPhase = "worker_startup" | "worker_stop";

/** Maps a channel-level authorization projection to its safe failure. */
export function validateAuthorization(
  channelId: ChannelId,
  authorization: ChannelAuthorizationResult,
): SignalError | undefined {
  if (authorization.channelId !== channelId) {
    return new SignalError(
      "invalid_channel_authorization",
      `Channel authorization returned a mismatched channel for ${channelId}`,
      { channelId, returnedChannelId: authorization.channelId },
    );
  }
  if (authorization.status === "not_found") {
    return new SignalError(
      "channel_not_found",
      `Channel ${channelId} was not found`,
      { channelId },
    );
  }
  if (authorization.status === "disabled") {
    return new SignalError(
      "channel_disabled",
      `Channel ${channelId} is disabled`,
      { channelId },
    );
  }
  return undefined;
}

/** Preserves typed worker failures and classifies unknown creation failures. */
export function normalizeWorkerFailure(
  channelId: ChannelId,
  cause: unknown,
): SignalError {
  if (cause instanceof SignalError) return cause;
  return new SignalError(
    "packaging_failed",
    `Channel ${channelId} worker failed before publication`,
    { channelId },
    cause === undefined ? undefined : { cause },
  );
}

/** Reports a worker that can no longer initialize a new viewer. */
export function workerUnavailable(channelId: ChannelId): SignalError {
  return new SignalError(
    "packaging_failed",
    `Channel ${channelId} worker is no longer joinable`,
    { channelId, reason: "worker_not_joinable" },
  );
}

/** Rejects a worker factory result that belongs to a different channel. */
export function workerChannelMismatch(channelId: ChannelId): SignalError {
  return new SignalError(
    "packaging_failed",
    `Channel ${channelId} worker returned for a different channel`,
    { channelId, reason: "worker_channel_mismatch" },
  );
}

/** Creates the stable per-waiter cancellation failure. */
export function subscriptionAborted(channelId: ChannelId): SignalError {
  return new SignalError(
    "subscription_aborted",
    `Channel ${channelId} subscription was cancelled`,
    { channelId },
  );
}

/** Creates the terminal manager gate failure. */
export function managerShutdown(channelId: ChannelId): SignalError {
  return new SignalError(
    "manager_shutdown",
    `Channel ${channelId} cannot be subscribed after manager shutdown`,
    { channelId },
  );
}

/**
 * Blocks replacement while a failed cleanup record still owns resources. Only
 * the diagnostic cause is carried, never a retry handle the manager must own.
 */
export function cleanupFailed(
  channelId: ChannelId,
  cause?: unknown,
): SignalError {
  return new SignalError(
    "runtime_cleanup_failed",
    `Channel ${channelId} runtime cleanup has not settled`,
    { channelId },
    cause === undefined ? undefined : { cause },
  );
}

/** Maps an administrative race to the state already committed by persistence. */
export function administrativeStop(
  channelId: ChannelId,
  reason: ChannelStopReason,
): SignalError {
  return reason === "disabled"
    ? new SignalError(
        "channel_disabled",
        `Channel ${channelId} was disabled before the subscription completed`,
        { channelId, stopReason: reason },
      )
    : new SignalError(
        "channel_not_found",
        `Channel ${channelId} was deleted before the subscription completed`,
        { channelId, stopReason: reason },
      );
}

/**
 * Keeps cleanup failures typed and names the cleanup phase that failed, so
 * operators can tell startup cleanup from a worker stop. A failure that already
 * names its phase passes through; anything else is wrapped with its cause.
 */
export function normalizeCleanupFailure(
  channelId: ChannelId,
  cause: unknown,
  phase: CleanupPhase,
): SignalError {
  if (
    cause instanceof SignalError &&
    cause.code === "runtime_cleanup_failed" &&
    cause.details.phase !== undefined
  ) {
    return cause;
  }
  return new SignalError(
    "runtime_cleanup_failed",
    `Channel ${channelId} runtime cleanup did not settle`,
    { channelId, phase },
    { cause },
  );
}
