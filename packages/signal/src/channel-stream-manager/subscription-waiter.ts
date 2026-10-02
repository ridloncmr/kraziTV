import type { SignalError } from "../errors.js";
import type { ChannelSubscription } from "./contracts.js";

/** A first-error-wins gate that an awaiting transition can race against. */
export type Interruption = {
  readonly promise: Promise<SignalError>;
  readonly error: SignalError | undefined;
  interrupt(error: SignalError): void;
};

/** One caller's pending subscribe, settled exactly once by the manager. */
export type SubscriptionWaiter = {
  readonly signal: AbortSignal | undefined;
  readonly promise: Promise<ChannelSubscription>;
  readonly interruption: Interruption;
  readonly resolve: (subscription: ChannelSubscription) => void;
  readonly reject: (error: unknown) => void;
  abortListener?: () => void;
  aborted: boolean;
  settled: boolean;
};

/** Creates one externally settled waiter without exposing manager internals. */
export function createWaiter(
  signal: AbortSignal | undefined,
): SubscriptionWaiter {
  let resolve!: (subscription: ChannelSubscription) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ChannelSubscription>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  return {
    signal,
    promise,
    interruption: createInterruption(),
    resolve,
    reject,
    aborted: signal?.aborted === true,
    settled: false,
  };
}

/** Creates a first-error-wins gate that an awaiting transition can race against. */
export function createInterruption(): Interruption {
  let resolve!: (error: SignalError) => void;
  let error: SignalError | undefined;
  const promise = new Promise<SignalError>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    /** The first interruption, so a transition can check it without awaiting. */
    get error() {
      return error;
    },
    interrupt: (interruptionError) => {
      if (error !== undefined) return;
      error = interruptionError;
      resolve(interruptionError);
    },
  };
}

/** Resolves one waiter and transfers lifetime ownership to its caller. */
export function resolveWaiter(
  waiter: SubscriptionWaiter,
  subscription: ChannelSubscription,
): void {
  if (waiter.settled) {
    subscription.close();
    return;
  }
  waiter.settled = true;
  detachAbort(waiter);
  waiter.resolve(subscription);
}

/** Rejects one waiter exactly once and releases its abort listener. */
export function rejectWaiter(waiter: SubscriptionWaiter, error: unknown): void {
  if (waiter.settled) return;
  waiter.settled = true;
  detachAbort(waiter);
  waiter.reject(error);
}

/** Releases an in-flight authorization await before rejecting its caller. */
export function interruptWaiter(
  waiter: SubscriptionWaiter,
  error: SignalError,
): void {
  waiter.interruption.interrupt(error);
  rejectWaiter(waiter, error);
}

/** Removes the per-call cancellation listener once it can no longer win. */
function detachAbort(waiter: SubscriptionWaiter): void {
  if (waiter.abortListener !== undefined) {
    waiter.signal?.removeEventListener("abort", waiter.abortListener);
  }
}
