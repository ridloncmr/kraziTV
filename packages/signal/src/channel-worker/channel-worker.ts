import type { Readable } from "node:stream";

import { assertPositiveSafeInteger } from "@krazitv/process";

import type { ChannelBroadcastSubscription } from "../channel-broadcast/channel-broadcast-subscription.js";
import { ChannelBroadcaster } from "../channel-broadcast/channel-broadcaster.js";
import type { SignalError } from "../errors.js";
import type { ChannelId, PlayoutProvider } from "../playout/contracts.js";
import type { Clock, TimerScheduler } from "../runtime/clock.js";
import { RetryableAttempt } from "../runtime/retryable-attempt.js";
import type {
  SignalPackager,
  SignalSession,
} from "../signal-packager/contracts.js";
import {
  interruptionError,
  normalizePackagingStartError,
  normalizeStartupError,
  WorkerCreationCleanupError,
} from "./channel-worker-errors.js";
import type { AiringItem, TransitionCoordinator } from "./contracts.js";
import { requireCurrent, toSignalItem } from "./playout-projection.js";
import {
  awaitControlled,
  createStartupGuard,
  type StartupGuard,
  type StartupInterruption,
} from "./startup-guard.js";
import { TransitionLoop } from "./transition-loop.js";

export type ChannelWorkerOptions = {
  playoutProvider: PlayoutProvider;
  packager: SignalPackager;
  clock: Clock;
  timers: TimerScheduler;
  transitionCoordinator: TransitionCoordinator;
  /** How long before each boundary the following item is selected and prepared. */
  prepareLeadMs: number;
  /**
   * Also bounds each transition: every dependency call must finish by the
   * scheduled boundary plus this window, or the worker fails.
   */
  startupTimeoutMs: number;
  subscriberBufferLimitBytes: number;
  retentionLimitBytes: number;
  findJoinPoint: (retainedBytes: Buffer) => number | undefined;
};

type JoinableOutputWaiter = {
  readonly promise: Promise<void>;
  dispose(): void;
};

/** Owns one channel's active packaging session and retained broadcast output. */
export class ChannelWorker {
  readonly completion: Promise<void>;
  private readonly stopAttempt = new RetryableAttempt();
  private readonly transitions: TransitionLoop;
  private readonly transitionsDone: Promise<void>;
  private failure: SignalError | undefined;

  /** Performs late state resolution and publishes only retained usable output. */
  static async start(
    channelId: ChannelId,
    signal: AbortSignal,
    options: ChannelWorkerOptions,
  ): Promise<ChannelWorker> {
    validateOptions(options);
    const guard = createStartupGuard(signal, options);
    const lookupCurrent = async () =>
      requireCurrent(
        await awaitControlled(
          () =>
            options.playoutProvider.getCurrent(channelId, options.clock.now()),
          guard,
          channelId,
        ),
        channelId,
      );

    try {
      // Preliminary validation only (ADR 0008): its offset is discarded,
      // because setup consumes wall time and the session must start from a
      // lookup made immediately before the packager starts.
      toSignalItem(await lookupCurrent(), channelId);

      while (true) {
        const current = await lookupCurrent();
        const item = toSignalItem(current, channelId);

        let session: SignalSession;
        try {
          session = options.packager.start(item);
        } catch (cause) {
          throw normalizePackagingStartError(cause, channelId);
        }

        let joinable: JoinableOutputWaiter | undefined;
        try {
          const broadcaster = new ChannelBroadcaster(session.output, {
            subscriberBufferLimitBytes: options.subscriberBufferLimitBytes,
            retentionLimitBytes: options.retentionLimitBytes,
            findJoinPoint: options.findJoinPoint,
          });
          joinable = waitForJoinableOutput(session.output, broadcaster);
          const outcome = await waitForAttempt(
            session,
            joinable,
            current.item.endsAt,
            guard,
            options,
          );
          if (outcome === "ready") {
            guard.dispose();
            return new ChannelWorker(
              channelId,
              session,
              broadcaster,
              {
                scheduleEntryId: current.item.scheduleEntryId,
                endsAt: current.item.endsAt,
              },
              options,
            );
          }

          await stopStartupSession(session, channelId);
          if (outcome === "expired") continue;
          throw interruptionError(outcome, channelId);
        } catch (cause) {
          if (cause instanceof WorkerCreationCleanupError) throw cause;
          await stopStartupSession(session, channelId);
          throw normalizeStartupError(cause, channelId);
        } finally {
          joinable?.dispose();
        }
      }
    } finally {
      guard.dispose();
    }
  }

  /**
   * Retains the single session and broadcaster, then starts crossing scheduled
   * boundaries. A transition failure stops the session and rejects completion.
   */
  private constructor(
    readonly channelId: ChannelId,
    private readonly session: SignalSession,
    readonly broadcaster: ChannelBroadcaster,
    airing: AiringItem,
    options: ChannelWorkerOptions,
  ) {
    this.transitions = new TransitionLoop(
      {
        channelId,
        session,
        playoutProvider: options.playoutProvider,
        transitionCoordinator: options.transitionCoordinator,
        clock: options.clock,
        timers: options.timers,
        prepareLeadMs: options.prepareLeadMs,
        recoveryTimeoutMs: options.startupTimeoutMs,
      },
      airing,
    );
    const transitionsRun = this.transitions.run();
    this.transitionsDone = transitionsRun.catch(() => undefined);
    this.completion = new Promise<void>((resolve, reject) => {
      // A transition failure outranks the session end its cleanup causes. A
      // session that ends first is reported as-is; the loop is then halted.
      void session.completion.then(
        () => (this.failure === undefined ? resolve() : reject(this.failure)),
        (error: unknown) => reject(this.failure ?? error),
      );
      void transitionsRun.catch((error: SignalError) => {
        this.failure = error;
        reject(error);
        void this.stop().catch(() => undefined);
      });
    });
    // Observers attach later; an unobserved worker failure must not crash Node.
    void this.completion.catch(() => undefined);
    void session.completion
      .catch(() => undefined)
      .then(() => this.transitions.halt())
      .catch(() => undefined);
  }

  /** Creates one viewer stream only while retained output remains joinable. */
  trySubscribe(): ChannelBroadcastSubscription | undefined {
    return this.broadcaster.trySubscribe();
  }

  /**
   * Shares active cleanup, retains success, and releases failure for retry.
   * Halting and session stop run together so a slow discard cannot keep the
   * FFmpeg process alive; resolving waits for the loop to discard any late
   * preparation.
   */
  stop(): Promise<void> {
    return this.stopAttempt.run(async () => {
      const [halted, stopped] = await Promise.allSettled([
        this.transitions.halt(),
        this.session.stop(),
      ]);
      await this.transitionsDone;
      if (stopped.status === "rejected") throw stopped.reason;
      // The loop retries a failed discard while unwinding; report only a
      // preparation that is still held.
      if (halted.status === "rejected" && this.transitions.holdsPreparation) {
        throw halted.reason;
      }
    });
  }
}

/** Preserves a cleanup handle when a private session cannot be settled. */
async function stopStartupSession(
  session: SignalSession,
  channelId: ChannelId,
): Promise<void> {
  try {
    await session.stop();
  } catch (cause) {
    throw new WorkerCreationCleanupError(channelId, cause, () =>
      session.stop(),
    );
  }
}

/** Rejects invalid runtime limits before any provider or process side effect. */
function validateOptions(options: ChannelWorkerOptions): void {
  assertPositiveSafeInteger(options.startupTimeoutMs, "startupTimeoutMs");
  assertPositiveSafeInteger(options.prepareLeadMs, "prepareLeadMs");
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
    const outcome = await Promise.race([readiness, expiry, guard.interrupted]);
    const interruption = guard.check();
    if (interruption !== undefined) return interruption;
    if (outcome === "ready" && options.clock.now() >= endsAt) {
      return "expired";
    }
    return outcome;
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
