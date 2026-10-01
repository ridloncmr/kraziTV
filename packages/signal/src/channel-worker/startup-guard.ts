import type { ChannelId } from "../playout/contracts.js";
import type { Clock, TimerScheduler } from "../runtime/clock.js";
import { interruptionError } from "./channel-worker-errors.js";

export type StartupInterruption = "aborted" | "timeout";

/** One overall startup bound shared by every await in a worker's startup. */
export type StartupGuard = {
  readonly interrupted: Promise<StartupInterruption>;
  check(): StartupInterruption | undefined;
  dispose(): void;
};

type StartupGuardOptions = {
  clock: Clock;
  timers: TimerScheduler;
  startupTimeoutMs: number;
};

/** Bounds every startup await with one overall timeout and caller cancellation. */
export function createStartupGuard(
  signal: AbortSignal,
  options: StartupGuardOptions,
): StartupGuard {
  const deadlineAt = options.clock.now() + options.startupTimeoutMs;
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
    check: () => {
      if (outcome === undefined && options.clock.now() >= deadlineAt) {
        interrupt("timeout");
      }
      return outcome;
    },
    dispose: () => {
      timeout.cancel();
      signal.removeEventListener("abort", abort);
    },
  };
}

/** Races provider work without allowing its late failure to become unhandled. */
export async function awaitControlled<T>(
  startOperation: () => Promise<T>,
  guard: StartupGuard,
  channelId: ChannelId,
): Promise<T> {
  const existingInterruption = guard.check();
  if (existingInterruption !== undefined) {
    throw interruptionError(existingInterruption, channelId);
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
  const interruption = guard.check();
  if (interruption !== undefined) {
    throw interruptionError(interruption, channelId);
  }
  if (result.status === "value") return result.value;
  if (result.status === "error") throw result.error;
  throw interruptionError(result.outcome, channelId);
}
