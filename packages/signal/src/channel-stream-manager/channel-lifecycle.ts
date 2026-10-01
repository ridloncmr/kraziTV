import type { ChannelBroadcastSubscription } from "../channel-broadcast/channel-broadcast-subscription.js";
import type { ManagedChannelWorker } from "../channel-worker/contracts.js";
import type { WorkerCreationCleanupError } from "../channel-worker/channel-worker-errors.js";
import type { ChannelId } from "../playout/contracts.js";
import type { ScheduledTask } from "../runtime/clock.js";
import { subscriptionAborted } from "./channel-stream-errors.js";
import {
  rejectWaiter,
  type Interruption,
  type SubscriptionWaiter,
} from "./subscription-waiter.js";

/** The settled result of one private worker creation. */
export type WorkerOutcome =
  | { status: "ready"; worker: ManagedChannelWorker }
  | {
      status: "failed";
      error: unknown;
      cleanup?: WorkerCreationCleanupError;
    };

/** Worker termination observed outside the serialized transition queue. */
type WorkerObservation = {
  terminated: boolean;
  failure?: unknown;
};

/** A channel whose worker is being created and has not yet been published. */
export type PendingLifecycle = {
  readonly kind: "pending";
  readonly channelId: ChannelId;
  readonly controller: AbortController;
  readonly creation: Promise<WorkerOutcome>;
  readonly waiters: Set<SubscriptionWaiter>;
  readonly observation: WorkerObservation;
  readonly publicationInterruption: Interruption;
  worker?: ManagedChannelWorker;
  cancelling: boolean;
  cleanupError?: unknown;
};

/** A channel whose published worker is serving viewers. */
export type ActiveLifecycle = {
  readonly kind: "active";
  readonly channelId: ChannelId;
  readonly worker: ManagedChannelWorker;
  readonly observation: WorkerObservation;
  readonly subscriptions: Set<ChannelBroadcastSubscription>;
  idleTask?: ScheduledTask;
  stopping: boolean;
  cleanupError?: unknown;
};

export type ChannelLifecycle = PendingLifecycle | ActiveLifecycle;

/** Identifies a record whose failed cleanup must settle before the channel is reused. */
export function hasRetainedCleanup(lifecycle: ChannelLifecycle): boolean {
  if (lifecycle.cleanupError !== undefined) return true;
  return lifecycle.kind === "active"
    ? lifecycle.stopping
    : lifecycle.cancelling;
}

/** Cancels one pending idle transition before another lifecycle event wins. */
export function cancelIdleStop(lifecycle: ActiveLifecycle): void {
  lifecycle.idleTask?.cancel();
  lifecycle.idleTask = undefined;
}

/** Ends viewer streams synchronously before process cleanup can block or fail. */
export function closeSubscriptions(lifecycle: ActiveLifecycle): void {
  const subscriptions = [...lifecycle.subscriptions];
  lifecycle.subscriptions.clear();
  for (const subscription of subscriptions) subscription.close();
}

/** Rejects and removes every waiter still owned by one pending creation. */
export function rejectPendingWaiters(
  pending: PendingLifecycle,
  error: unknown,
): void {
  for (const waiter of pending.waiters) rejectWaiter(waiter, error);
  pending.waiters.clear();
}

/** Rejects waiters whose cancellation became observable before publication. */
export function rejectAbortedWaiters(pending: PendingLifecycle): void {
  for (const waiter of [...pending.waiters]) {
    if (!waiter.aborted) continue;
    pending.waiters.delete(waiter);
    rejectWaiter(waiter, subscriptionAborted(pending.channelId));
  }
}
