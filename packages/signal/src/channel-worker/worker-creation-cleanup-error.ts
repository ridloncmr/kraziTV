import type { ChannelId } from "../playout/contracts.js";
import { SignalError } from "../errors.js";

/** Carries ownership forward when a private startup cannot finish cleanup. */
export class WorkerCreationCleanupError extends SignalError {
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
