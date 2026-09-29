import type { Readable } from "node:stream";

import { ChannelBroadcaster } from "../channel-broadcast/channel-broadcaster.js";
import { SignalError } from "../errors.js";
import type {
  ChannelId,
  CurrentPlayoutResult,
  PlayoutProvider,
} from "../playout/contracts.js";
import type { Clock, TimerScheduler } from "../runtime/clock.js";
import type {
  SignalPackager,
  SignalPlayoutItem,
  SignalSession,
} from "../signal-packager/contracts.js";

export type ChannelWorkerOptions = {
  playoutProvider: PlayoutProvider;
  packager: SignalPackager;
  clock: Clock;
  timers: TimerScheduler;
  startupTimeoutMs: number;
  subscriberBufferLimitBytes: number;
  retentionLimitBytes: number;
  findJoinPoint(retainedBytes: Buffer): number | undefined;
};

type StartupInterruption = "aborted" | "timeout";

type StartupGuard = {
  readonly interrupted: Promise<StartupInterruption>;
  readonly outcome: StartupInterruption | undefined;
  dispose(): void;
};

type JoinableOutputWaiter = {
  readonly promise: Promise<void>;
  dispose(): void;
};

/** Owns one channel's active packaging session and retained broadcast output. */
export class ChannelWorker {
  private stopPromise: Promise<void> | undefined;

  /** Performs late state resolution and publishes only retained usable output. */
  static async start(
    channelId: ChannelId,
    signal: AbortSignal,
    options: ChannelWorkerOptions,
  ): Promise<ChannelWorker> {
    validateOptions(options);
    const guard = createStartupGuard(signal, options);

    try {
      toSignalItem(
        requireCurrent(
          await awaitControlled(
            () =>
              options.playoutProvider.getCurrent(
                channelId,
                options.clock.now(),
              ),
            guard,
            channelId,
          ),
          channelId,
        ),
        channelId,
      );

      while (true) {
        const current = requireCurrent(
          await awaitControlled(
            () =>
              options.playoutProvider.getCurrent(
                channelId,
                options.clock.now(),
              ),
            guard,
            channelId,
          ),
          channelId,
        );
        const item = toSignalItem(current, channelId);

        let session: SignalSession;
        try {
          session = options.packager.start(item);
        } catch (cause) {
          throw normalizePackagingStartError(cause, channelId);
        }

        const broadcaster = new ChannelBroadcaster(session.output, {
          subscriberBufferLimitBytes: options.subscriberBufferLimitBytes,
          retentionLimitBytes: options.retentionLimitBytes,
          findJoinPoint: options.findJoinPoint,
        });
        const joinable = waitForJoinableOutput(session.output, broadcaster);

        try {
          const outcome = await waitForAttempt(
            session,
            joinable,
            current.item.endsAt,
            guard,
            options,
          );
          if (outcome === "ready") {
            guard.dispose();
            return new ChannelWorker(channelId, session, broadcaster);
          }

          await session.stop();
          if (outcome === "expired") continue;
          throw interruptionError(outcome, channelId);
        } catch (cause) {
          await session.stop();
          throw normalizeStartupError(cause, channelId);
        } finally {
          joinable.dispose();
        }
      }
    } finally {
      guard.dispose();
    }
  }

  /** Retains the single session and broadcaster that make up this worker. */
  private constructor(
    readonly channelId: ChannelId,
    private readonly session: SignalSession,
    readonly broadcaster: ChannelBroadcaster,
  ) {}

  /** Stops the owned packaging session exactly once and shares cleanup. */
  stop(): Promise<void> {
    this.stopPromise ??= this.session.stop();
    return this.stopPromise;
  }
}

/** Rejects invalid runtime limits before any provider or process side effect. */
function validateOptions(options: ChannelWorkerOptions): void {
  assertPositiveSafeInteger(options.startupTimeoutMs, "startupTimeoutMs");
  assertPositiveSafeInteger(
    options.subscriberBufferLimitBytes,
    "subscriberBufferLimitBytes",
  );
  assertPositiveSafeInteger(options.retentionLimitBytes, "retentionLimitBytes");
  const deadline = options.clock.now() + options.startupTimeoutMs;
  if (!Number.isSafeInteger(deadline)) {
    throw new RangeError("worker startup deadline must be a safe integer");
  }
}

/** Converts one atomic current-state projection into route-safe failures. */
function requireCurrent(
  result: CurrentPlayoutResult,
  channelId: ChannelId,
): Extract<CurrentPlayoutResult, { status: "current" }> {
  if (result.channelId !== channelId) {
    throw invalidItem(channelId, "channel_mismatch");
  }
  if (result.status === "no_current") {
    throw new SignalError(
      result.reason === "media_unavailable"
        ? "media_unavailable"
        : "no_current_playout",
      result.reason === "media_unavailable"
        ? `Current media is unavailable for channel ${channelId}`
        : `Channel ${channelId} has no current playout item`,
      {
        channelId,
        reason: result.reason,
        ...(result.scheduleEntryId === undefined
          ? {}
          : { scheduleEntryId: result.scheduleEntryId }),
      },
    );
  }
  if (result.item.channelId !== channelId) {
    throw invalidItem(channelId, "item_channel_mismatch");
  }
  return result;
}

/** Preserves the absolute end while translating selected playout for packaging. */
function toSignalItem(
  current: Extract<CurrentPlayoutResult, { status: "current" }>,
  channelId: ChannelId,
): SignalPlayoutItem {
  const playDurationMs = current.item.endsAt - current.evaluatedAt;
  if (
    !Number.isSafeInteger(current.evaluatedAt) ||
    !Number.isSafeInteger(current.item.endsAt) ||
    !Number.isSafeInteger(current.mediaOffsetMs) ||
    current.mediaOffsetMs < 0 ||
    !Number.isSafeInteger(playDurationMs) ||
    playDurationMs <= 0
  ) {
    throw invalidItem(channelId, "invalid_current_timing");
  }

  return {
    channelId,
    scheduleEntryId: current.item.scheduleEntryId,
    mediaItemId: current.item.mediaItemId,
    mediaPath: current.item.mediaPath,
    mediaOffsetMs: current.mediaOffsetMs,
    playDurationMs,
  };
}

/** Bounds every startup await with one overall timeout and caller cancellation. */
function createStartupGuard(
  signal: AbortSignal,
  options: ChannelWorkerOptions,
): StartupGuard {
  let resolve!: (outcome: StartupInterruption) => void;
  let outcome: StartupInterruption | undefined;
  const interrupted = new Promise<StartupInterruption>((settle) => {
    resolve = settle;
  });
  const interrupt = (nextOutcome: StartupInterruption): void => {
    if (outcome !== undefined) return;
    outcome = nextOutcome;
    resolve(nextOutcome);
  };
  const timeout = options.timers.setTimeout(
    () => interrupt("timeout"),
    options.startupTimeoutMs,
  );
  const abort = (): void => interrupt("aborted");
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();

  return {
    interrupted,
    get outcome() {
      return outcome;
    },
    dispose: () => {
      timeout.cancel();
      signal.removeEventListener("abort", abort);
    },
  };
}

/** Races provider work without allowing its late failure to become unhandled. */
async function awaitControlled<T>(
  startOperation: () => Promise<T>,
  guard: StartupGuard,
  channelId: ChannelId,
): Promise<T> {
  if (guard.outcome !== undefined) {
    throw interruptionError(guard.outcome, channelId);
  }
  const operation = startOperation();
  const result = await Promise.race([
    operation.then(
      (value) => ({ status: "value" as const, value }),
      (error: unknown) => ({ status: "error" as const, error }),
    ),
    guard.interrupted.then((outcome) => ({
      status: "interrupted" as const,
      outcome,
    })),
  ]);
  if (result.status === "value") return result.value;
  if (result.status === "error") throw result.error;
  throw interruptionError(result.outcome, channelId);
}

/** Waits for both packager readiness and retained bytes, or an earlier bound. */
async function waitForAttempt(
  session: SignalSession,
  joinable: JoinableOutputWaiter,
  endsAt: number,
  guard: StartupGuard,
  options: ChannelWorkerOptions,
): Promise<"ready" | "expired" | StartupInterruption> {
  const remainingMs = Math.max(0, endsAt - options.clock.now());
  const readiness = Promise.all([session.ready, joinable.promise]).then(
    () => "ready" as const,
  );
  let expiryTask: ReturnType<TimerScheduler["setTimeout"]> | undefined;
  const expiry = new Promise<"expired">((resolve) => {
    expiryTask = options.timers.setTimeout(
      () => resolve("expired"),
      remainingMs,
    );
  });
  try {
    return await Promise.race([readiness, expiry, guard.interrupted]);
  } finally {
    expiryTask?.cancel();
  }
}

/** Observes retained joinability without coupling the broadcaster to worker state. */
function waitForJoinableOutput(
  output: Readable,
  broadcaster: ChannelBroadcaster,
): JoinableOutputWaiter {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  const inspect = (): void => {
    if (broadcaster.hasJoinableInitialization) resolve();
  };
  output.on("data", inspect);
  inspect();
  return {
    promise,
    dispose: () => output.off("data", inspect),
  };
}

/** Preserves typed packaging failures and classifies unknown start exceptions. */
function normalizePackagingStartError(
  cause: unknown,
  channelId: ChannelId,
): SignalError {
  if (cause instanceof SignalError) return cause;
  return new SignalError(
    "packaging_start_failed",
    `Signal packaging could not start for channel ${channelId}`,
    { channelId },
    { cause },
  );
}

/** Keeps deliberate worker interruptions distinct from packaging failures. */
function normalizeStartupError(
  cause: unknown,
  channelId: ChannelId,
): SignalError {
  if (cause instanceof SignalError) return cause;
  return new SignalError(
    "packaging_failed",
    `Signal packaging failed while channel ${channelId} was starting`,
    { channelId },
    { cause },
  );
}

/** Creates the provider-neutral error for cancellation or exhausted startup time. */
function interruptionError(
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

/** Creates a safe invalid-projection error without exposing a media path. */
function invalidItem(channelId: ChannelId, reason: string): SignalError {
  return new SignalError(
    "invalid_playout_item",
    `Channel ${channelId} returned an invalid current playout item`,
    { channelId, reason },
  );
}

/** Enforces deterministic byte and duration limits. */
function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}
