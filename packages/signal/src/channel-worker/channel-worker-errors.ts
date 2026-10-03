import { SignalError, toSignalError } from "../errors.js";
import type { ChannelId } from "../playout/contracts.js";
import type { TransitionStep } from "./contracts.js";
import type { StartupInterruption } from "./startup-guard.js";

/** Unwinds the transition loop quietly once the worker has halted it. */
export class TransitionLoopHalted extends Error {}

/** Preserves typed packaging failures and classifies unknown start exceptions. */
export function normalizePackagingStartError(
  cause: unknown,
  channelId: ChannelId,
): SignalError {
  return toSignalError(
    cause,
    "packaging_start_failed",
    `Signal packaging could not start for channel ${channelId}`,
    { channelId },
  );
}

/** Keeps deliberate worker interruptions distinct from packaging failures. */
export function normalizeStartupError(
  cause: unknown,
  channelId: ChannelId,
): SignalError {
  return toSignalError(
    cause,
    "packaging_failed",
    `Signal packaging failed while channel ${channelId} was starting`,
    { channelId },
  );
}

/** Keeps typed packaging failures and classifies unknown preparation errors. */
export function normalizePreparationError(
  cause: unknown,
  channelId: ChannelId,
): SignalError {
  return toSignalError(
    cause,
    "packaging_failed",
    `Signal packaging could not prepare the next item for channel ${channelId}`,
    { channelId },
  );
}

/** Keeps typed failures and classifies coordinator or provider errors. */
export function normalizeTransitionError(
  cause: unknown,
  channelId: ChannelId,
): SignalError {
  return toSignalError(
    cause,
    "transition_failed",
    `Channel ${channelId} could not transition to its next playout item`,
    { channelId },
  );
}

/** Ends recovery once every fresh selection came back stale, so a churning schedule fails the worker. */
export function recoveryAttemptsExhausted(channelId: ChannelId): SignalError {
  return new SignalError(
    "transition_failed",
    `Channel ${channelId} could not commit fresh playout`,
    { channelId, reason: "recovery_attempts_exhausted" },
  );
}

/**
 * Reports a coordinator that answered `committed` without running the commit
 * callback; trusting it would leave the session on the old item.
 */
export function committedWithoutCommit(channelId: ChannelId): SignalError {
  return new SignalError(
    "transition_failed",
    `Channel ${channelId} transition was reported committed without its commit`,
    { channelId },
  );
}

/** Classifies an expired dependency call as a worker-fatal transition failure. */
export function transitionDeadlineExceeded(
  channelId: ChannelId,
  step: TransitionStep,
): SignalError {
  return new SignalError(
    "transition_failed",
    `Channel ${channelId} did not finish ${step} before its transition deadline`,
    { channelId, step, reason: "deadline_exceeded" },
  );
}

/** Carries ownership forward when a private startup cannot finish cleanup. */
export class WorkerCreationCleanupError extends SignalError {
  /** Keeps the retry so the manager can finish the cleanup the startup abandoned. */
  constructor(
    channelId: ChannelId,
    cause: unknown,
    private readonly retry: () => Promise<void>,
  ) {
    super(
      "runtime_cleanup_failed",
      `Channel ${channelId} worker startup cleanup did not settle`,
      { channelId, phase: "worker_startup" },
      { cause },
    );
  }

  /** Retries only the startup resource whose cleanup remains unsettled. */
  retryCleanup(): Promise<void> {
    return this.retry();
  }
}

/** Creates the provider-neutral error for cancellation or exhausted startup time. */
export function interruptionError(
  outcome: StartupInterruption,
  channelId: ChannelId,
): SignalError {
  return outcome === "aborted"
    ? new SignalError(
        "subscription_aborted",
        `Channel ${channelId} startup was cancelled`,
        { channelId },
      )
    : new SignalError(
        "worker_startup_timeout",
        `Channel ${channelId} did not become ready before its startup timeout`,
        { channelId },
      );
}
