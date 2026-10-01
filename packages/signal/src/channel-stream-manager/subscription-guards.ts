import type { ChannelBroadcastSubscription } from "../channel-broadcast/channel-broadcast-subscription.js";
import type {
  ChannelAuthorizationResult,
  ManagedChannelWorker,
} from "../channel-worker/contracts.js";
import type { SignalError } from "../errors.js";
import type { ChannelId } from "../playout/contracts.js";
import type { PendingLifecycle } from "./channel-lifecycle.js";
import {
  normalizeWorkerFailure,
  subscriptionAborted,
  validateAuthorization,
  workerChannelMismatch,
  workerUnavailable,
} from "./channel-stream-errors.js";
import {
  rejectWaiter,
  type SubscriptionWaiter,
} from "./subscription-waiter.js";

/** How one provider lookup ended when raced against an operational gate. */
export type AuthorizationOutcome =
  | { status: "resolved"; authorization: ChannelAuthorizationResult }
  | { status: "failed"; error: unknown }
  | { status: "interrupted"; error: SignalError };

/** Why a ready worker will not be published: an error for its waiters, or no waiters left. */
export type PublicationBlock =
  { kind: "failed"; error: unknown } | { kind: "unwatched" };

type JoinedWaiters = {
  kind: "joined";
  created: Array<{
    waiter: SubscriptionWaiter;
    subscription: ChannelBroadcastSubscription;
  }>;
};

/**
 * Returns why a finished, uninterrupted lookup refuses the channel, or
 * undefined when the channel may be joined. The error is wrapped because a
 * provider may reject with any value, including undefined.
 */
export function findAuthorizationFailure(
  channelId: ChannelId,
  outcome: Exclude<AuthorizationOutcome, { status: "interrupted" }>,
): { error: unknown } | undefined {
  if (outcome.status === "failed") return { error: outcome.error };
  const error = validateAuthorization(channelId, outcome.authorization);
  return error === undefined ? undefined : { error };
}

/**
 * Returns the first publication guard a ready worker fails, or undefined when
 * it may publish. Guards run in precedence order: administrative interruption,
 * authorization, worker health, remaining viewers, then worker identity.
 */
export function findPublicationBlock(
  pending: PendingLifecycle,
  worker: ManagedChannelWorker,
  authorizationOutcome: AuthorizationOutcome,
): PublicationBlock | undefined {
  const interruptionError = pending.publicationInterruption.error;
  if (interruptionError !== undefined) {
    return { kind: "failed", error: interruptionError };
  }
  if (authorizationOutcome.status !== "resolved") {
    return { kind: "failed", error: authorizationOutcome.error };
  }
  if (pending.observation.terminated) {
    return {
      kind: "failed",
      error: normalizeWorkerFailure(
        pending.channelId,
        pending.observation.failure,
      ),
    };
  }
  const authorizationError = validateAuthorization(
    pending.channelId,
    authorizationOutcome.authorization,
  );
  if (authorizationError !== undefined) {
    return { kind: "failed", error: authorizationError };
  }
  if (pending.waiters.size === 0) return { kind: "unwatched" };
  if (worker.channelId !== pending.channelId) {
    return { kind: "failed", error: workerChannelMismatch(pending.channelId) };
  }
  return undefined;
}

/**
 * Subscribes every still-live waiter to a ready worker as one unit: if any
 * subscription fails, the ones already opened are closed so none leak.
 */
export function joinPendingWaiters(
  pending: PendingLifecycle,
  worker: ManagedChannelWorker,
): JoinedWaiters | PublicationBlock {
  const created: JoinedWaiters["created"] = [];
  try {
    for (const waiter of pending.waiters) {
      if (waiter.aborted) {
        rejectWaiter(waiter, subscriptionAborted(pending.channelId));
        continue;
      }
      const subscription = worker.trySubscribe();
      if (subscription === undefined) {
        throw workerUnavailable(pending.channelId);
      }
      created.push({ waiter, subscription });
    }
  } catch (error) {
    for (const { subscription } of created) subscription.close();
    return {
      kind: "failed",
      error: normalizeWorkerFailure(pending.channelId, error),
    };
  }
  return created.length === 0
    ? { kind: "unwatched" }
    : { kind: "joined", created };
}
