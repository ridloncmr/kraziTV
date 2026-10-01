import type { ChannelBroadcastSubscription } from "../channel-broadcast/channel-broadcast-subscription.js";
import type {
  ChannelAuthorization,
  ChannelAuthorizationResult,
} from "../channel-worker/contracts.js";
import type {
  ChannelWorkerFactory,
  ManagedChannelWorker,
} from "../channel-worker/worker-factory.js";
import { WorkerCreationCleanupError } from "../channel-worker/worker-creation-cleanup-error.js";
import type { SignalError } from "../errors.js";
import type { ChannelId } from "../playout/contracts.js";
import type { ScheduledTask, TimerScheduler } from "../runtime/clock.js";
import {
  cancelIdleStop,
  closeSubscriptions,
  hasRetainedCleanup,
  rejectAbortedWaiters,
  rejectPendingWaiters,
  type ActiveLifecycle,
  type ChannelLifecycle,
  type PendingLifecycle,
  type WorkerOutcome,
} from "./channel-lifecycle.js";
import {
  administrativeStop,
  cleanupFailed,
  type CleanupPhase,
  managerShutdown,
  normalizeCleanupFailure,
  normalizeWorkerFailure,
  subscriptionAborted,
  validateAuthorization,
  workerChannelMismatch,
  workerUnavailable,
} from "./channel-stream-errors.js";
import { ChannelTransitionQueue } from "./channel-transition-queue.js";
import type {
  ChannelStopReason,
  ChannelStreamManagerContract,
  ChannelSubscribeOptions,
  ChannelSubscription,
} from "./contracts.js";
import {
  createInterruption,
  createWaiter,
  interruptWaiter,
  rejectWaiter,
  resolveWaiter,
  type Interruption,
  type SubscriptionWaiter,
} from "./subscription-waiter.js";

type ChannelStreamManagerOptions = {
  authorization: ChannelAuthorization;
  workerFactory: ChannelWorkerFactory<ManagedChannelWorker>;
  timers: TimerScheduler;
  idleGraceMs: number;
};

type AuthorizationOutcome =
  | { status: "resolved"; authorization: ChannelAuthorizationResult }
  | { status: "failed"; error: unknown }
  | { status: "interrupted"; error: SignalError };

/** Why a ready worker will not be published: an error for its waiters, or no waiters left. */
type PublicationBlock =
  { kind: "failed"; error: unknown } | { kind: "unwatched" };

type JoinedWaiters = {
  kind: "joined";
  created: Array<{
    waiter: SubscriptionWaiter;
    subscription: ChannelBroadcastSubscription;
  }>;
};

/** Serializes channel broadcast creation, publication, and terminal cleanup. */
export class ChannelStreamManager implements ChannelStreamManagerContract {
  private readonly lifecycles = new Map<ChannelId, ChannelLifecycle>();
  private readonly transitions = new ChannelTransitionQueue();
  private readonly authorizingWaiters = new Map<
    ChannelId,
    Set<SubscriptionWaiter>
  >();
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;

  /** Retains provider-neutral ports without starting any channel resources. */
  constructor(private readonly options: ChannelStreamManagerOptions) {
    assertNonNegativeSafeInteger(options.idleGraceMs, "idleGraceMs");
  }

  /** Authorizes one viewer and joins or creates its channel's shared signal. */
  subscribe(
    channelId: ChannelId,
    options: ChannelSubscribeOptions = {},
  ): Promise<ChannelSubscription> {
    if (this.shuttingDown) {
      return Promise.reject(managerShutdown(channelId));
    }

    const waiter = createWaiter(options.signal);
    waiter.abortListener = () => {
      waiter.aborted = true;
      waiter.interruption.interrupt(subscriptionAborted(channelId));
      this.runInBackground(channelId, () =>
        this.cancelWaiter(channelId, waiter),
      );
    };
    waiter.signal?.addEventListener("abort", waiter.abortListener, {
      once: true,
    });
    if (waiter.signal?.aborted === true) waiter.abortListener();
    if (waiter.aborted) return waiter.promise;

    this.addAuthorizingWaiter(channelId, waiter);
    void this.transitions
      .run(channelId, () => this.joinSubscription(channelId, waiter))
      .catch((error: unknown) => rejectWaiter(waiter, error));
    return waiter.promise;
  }

  /** Serializes an immediate operational stop without making the manager terminal. */
  stopChannel(channelId: ChannelId, reason: ChannelStopReason): Promise<void> {
    const error = administrativeStop(channelId, reason);
    this.rejectAuthorizingWaiters(channelId, error);
    this.interruptPublication(channelId, error);
    return this.transitions.run(channelId, () =>
      this.stopChannelRuntime(channelId, error),
    );
  }

  /** Permanently rejects new work and settles every worker known to this manager. */
  shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;

    this.shuttingDown = true;
    for (const channelId of [...this.authorizingWaiters.keys()]) {
      this.rejectAuthorizingWaiters(channelId, managerShutdown(channelId));
    }
    for (const channelId of this.lifecycles.keys()) {
      this.interruptPublication(channelId, managerShutdown(channelId));
    }
    const channelIds = new Set([
      ...this.lifecycles.keys(),
      ...this.transitions.channelIds(),
    ]);
    const attempt = Promise.allSettled(
      [...channelIds].map((channelId) =>
        this.transitions.run(channelId, () =>
          this.stopChannelRuntime(channelId, managerShutdown(channelId)),
        ),
      ),
    ).then((results) => {
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure !== undefined) throw failure.reason;
    });
    // A successful attempt stays memoized; a failed one is released for retry.
    this.shutdownPromise = attempt;
    void attempt.catch(() => {
      if (this.shutdownPromise === attempt) this.shutdownPromise = undefined;
    });
    return attempt;
  }

  /**
   * Queues a transition that no caller awaits. Its failure is dropped here
   * because cleanup failures stay on the lifecycle record and the next
   * subscribe or stop retries them.
   */
  private runInBackground(
    channelId: ChannelId,
    operation: () => Promise<void> | void,
  ): void {
    void this.transitions.run(channelId, operation).catch(() => undefined);
  }

  /** Rechecks caller state around authorization before joining shared runtime state. */
  private async joinSubscription(
    channelId: ChannelId,
    waiter: SubscriptionWaiter,
  ): Promise<void> {
    if (waiter.settled) return;
    if (this.shuttingDown) {
      rejectWaiter(waiter, managerShutdown(channelId));
      return;
    }
    if (waiter.aborted) {
      rejectWaiter(waiter, subscriptionAborted(channelId));
      return;
    }

    const authorizationOutcome = await this.authorizeUnlessInterrupted(
      channelId,
      waiter.interruption,
    );
    this.removeAuthorizingWaiter(channelId, waiter);
    if (authorizationOutcome.status === "interrupted" || waiter.settled) return;
    if (authorizationOutcome.status === "failed") {
      rejectWaiter(waiter, authorizationOutcome.error);
      return;
    }
    const authorizationError = validateAuthorization(
      channelId,
      authorizationOutcome.authorization,
    );
    if (authorizationError !== undefined) {
      rejectWaiter(waiter, authorizationError);
      return;
    }

    let lifecycle = this.lifecycles.get(channelId);
    if (lifecycle !== undefined && hasRetainedCleanup(lifecycle)) {
      try {
        await this.stopChannelRuntime(channelId, cleanupFailed(channelId));
      } catch {
        rejectWaiter(waiter, cleanupFailed(channelId));
        return;
      }
      if (this.shuttingDown) {
        rejectWaiter(waiter, managerShutdown(channelId));
        return;
      }
      if (waiter.aborted) {
        rejectWaiter(waiter, subscriptionAborted(channelId));
        return;
      }
      lifecycle = this.lifecycles.get(channelId);
    }

    if (lifecycle?.kind === "active") {
      if (lifecycle.observation.terminated) {
        lifecycle.stopping = true;
        rejectWaiter(
          waiter,
          normalizeWorkerFailure(channelId, lifecycle.observation.failure),
        );
        await this.stopActiveLifecycle(lifecycle);
        return;
      }
      let subscription: ChannelBroadcastSubscription | undefined;
      try {
        subscription = lifecycle.worker.trySubscribe();
      } catch (error) {
        lifecycle.stopping = true;
        rejectWaiter(waiter, normalizeWorkerFailure(channelId, error));
        await this.stopActiveLifecycle(lifecycle);
        return;
      }
      if (subscription !== undefined) {
        this.trackSubscription(lifecycle, subscription);
        cancelIdleStop(lifecycle);
        resolveWaiter(waiter, subscription);
        return;
      }

      rejectWaiter(waiter, workerUnavailable(channelId));
      return;
    }

    if (lifecycle?.kind === "pending") {
      lifecycle.waiters.add(waiter);
      return;
    }

    const pending = this.startPendingLifecycle(channelId, waiter);
    this.lifecycles.set(channelId, pending);
  }

  /** Races one provider lookup against a gate that must not wait behind the provider. */
  private async authorizeUnlessInterrupted(
    channelId: ChannelId,
    interruption: Interruption,
  ): Promise<AuthorizationOutcome> {
    let request: Promise<ChannelAuthorizationResult>;
    try {
      request = this.options.authorization.getChannelAuthorization(channelId);
    } catch (error) {
      request = Promise.reject(error);
    }
    return Promise.race<AuthorizationOutcome>([
      request.then(
        (authorization) => ({ status: "resolved", authorization }),
        (error: unknown) => ({ status: "failed", error }),
      ),
      interruption.promise.then((error) => ({ status: "interrupted", error })),
    ]);
  }

  /** Starts one private creation and schedules exactly one publication transition. */
  private startPendingLifecycle(
    channelId: ChannelId,
    firstWaiter: SubscriptionWaiter,
  ): PendingLifecycle {
    const controller = new AbortController();
    let started: Promise<ManagedChannelWorker>;
    try {
      started = this.options.workerFactory.create(channelId, controller.signal);
    } catch (error) {
      started = Promise.reject(error);
    }
    const creation: Promise<WorkerOutcome> = started.then(
      (worker) => ({ status: "ready" as const, worker }),
      (error: unknown) => ({
        status: "failed" as const,
        error,
        ...(error instanceof WorkerCreationCleanupError
          ? { cleanup: error }
          : {}),
      }),
    );
    const pending: PendingLifecycle = {
      kind: "pending",
      channelId,
      controller,
      creation,
      waiters: new Set([firstWaiter]),
      observation: { terminated: false },
      publicationInterruption: createInterruption(),
      cancelling: false,
    };

    void creation.then((outcome) => {
      if (outcome.status === "ready") {
        const { worker } = outcome;
        pending.worker = worker;
        const observeTermination = (): void => {
          pending.observation.terminated = true;
          this.runInBackground(channelId, () =>
            this.handleWorkerTermination(pending, worker),
          );
        };
        void worker.completion.then(observeTermination, (error: unknown) => {
          pending.observation.failure = error;
          observeTermination();
        });
      }
      this.runInBackground(channelId, () =>
        this.publishCreation(pending, outcome),
      );
    });

    return pending;
  }

  /** Publishes one ready worker only if every serialized publication guard wins. */
  private async publishCreation(
    pending: PendingLifecycle,
    outcome: WorkerOutcome,
  ): Promise<void> {
    if (this.lifecycles.get(pending.channelId) !== pending) {
      if (outcome.status === "ready") await outcome.worker.stop();
      return;
    }
    if (this.shuttingDown) {
      rejectPendingWaiters(pending, managerShutdown(pending.channelId));
      if (outcome.status === "ready") {
        await this.stopPendingWorker(pending, outcome.worker);
      } else {
        await this.stopFailedPendingCreation(pending, outcome);
      }
      return;
    }
    if (outcome.status === "failed") {
      rejectAbortedWaiters(pending);
      rejectPendingWaiters(
        pending,
        outcome.cleanup === undefined
          ? normalizeWorkerFailure(pending.channelId, outcome.error)
          : cleanupFailed(pending.channelId, outcome.cleanup.cause),
      );
      if (outcome.cleanup === undefined) {
        this.lifecycles.delete(pending.channelId);
      } else {
        pending.cancelling = true;
        pending.cleanupError = outcome.error;
      }
      return;
    }
    if (pending.cancelling) return;

    const authorizationOutcome = await this.authorizeUnlessInterrupted(
      pending.channelId,
      pending.publicationInterruption,
    );
    rejectAbortedWaiters(pending);
    const block = findPublicationBlock(
      pending,
      outcome.worker,
      authorizationOutcome,
    );
    if (block !== undefined) {
      await this.abandonPublication(pending, outcome.worker, block);
      return;
    }

    const joined = joinPendingWaiters(pending, outcome.worker);
    if (joined.kind !== "joined") {
      await this.abandonPublication(pending, outcome.worker, joined);
      return;
    }

    const active: ActiveLifecycle = {
      kind: "active",
      channelId: pending.channelId,
      worker: outcome.worker,
      observation: pending.observation,
      subscriptions: new Set(),
      stopping: false,
    };
    this.lifecycles.set(pending.channelId, active);
    for (const { waiter, subscription } of joined.created) {
      this.trackSubscription(active, subscription);
      resolveWaiter(waiter, subscription);
    }
    pending.waiters.clear();
  }

  /**
   * Stops a ready worker that will not be published. A failed publication
   * rejects its waiters; an unwatched one cancels creation, since nobody is
   * left to reject.
   */
  private async abandonPublication(
    pending: PendingLifecycle,
    worker: ManagedChannelWorker,
    block: PublicationBlock,
  ): Promise<void> {
    if (block.kind === "failed") {
      rejectPendingWaiters(pending, block.error);
    } else {
      pending.cancelling = true;
      pending.controller.abort();
    }
    await this.stopPendingWorker(pending, worker);
  }

  /** Removes one cancelled waiter and stops creation only when none remain. */
  private async cancelWaiter(
    channelId: ChannelId,
    waiter: SubscriptionWaiter,
  ): Promise<void> {
    this.removeAuthorizingWaiter(channelId, waiter);
    if (!waiter.settled) {
      rejectWaiter(waiter, subscriptionAborted(channelId));
    }
    const lifecycle = this.lifecycles.get(channelId);
    if (lifecycle?.kind !== "pending" || !lifecycle.waiters.delete(waiter)) {
      return;
    }
    if (lifecycle.waiters.size > 0 || lifecycle.cancelling) return;

    await this.stopPendingLifecycle(lifecycle);
  }

  /** Removes a spontaneously terminated worker and rejects unpublished waiters. */
  private async handleWorkerTermination(
    pending: PendingLifecycle,
    worker: ManagedChannelWorker,
  ): Promise<void> {
    const lifecycle = this.lifecycles.get(pending.channelId);
    if (lifecycle === pending) {
      rejectPendingWaiters(
        pending,
        normalizeWorkerFailure(pending.channelId, pending.observation.failure),
      );
      await this.stopPendingWorker(pending, worker);
      return;
    }
    if (lifecycle?.kind === "active" && lifecycle.worker === worker) {
      lifecycle.stopping = true;
      await this.stopActiveLifecycle(lifecycle);
    }
  }

  /**
   * Stops whichever lifecycle record a channel holds, or retries its retained
   * cleanup, so stop, shutdown, and viewer recovery share one settlement path.
   */
  private async stopChannelRuntime(
    channelId: ChannelId,
    waiterError: SignalError,
  ): Promise<void> {
    const lifecycle = this.lifecycles.get(channelId);
    if (lifecycle === undefined) return;
    if (lifecycle.kind === "active") {
      lifecycle.stopping = true;
      await this.stopActiveLifecycle(lifecycle);
      return;
    }

    rejectPendingWaiters(lifecycle, waiterError);
    await this.stopPendingLifecycle(lifecycle);
  }

  /** Cancels one unpublished creation and settles whatever its outcome left behind. */
  private async stopPendingLifecycle(pending: PendingLifecycle): Promise<void> {
    pending.cancelling = true;
    pending.controller.abort();
    const outcome = await pending.creation;
    if (outcome.status === "ready") {
      await this.stopPendingWorker(pending, outcome.worker);
    } else {
      await this.stopFailedPendingCreation(pending, outcome);
    }
  }

  /** Lets stop or shutdown defeat publication without awaiting its provider lookup. */
  private interruptPublication(channelId: ChannelId, error: SignalError): void {
    const lifecycle = this.lifecycles.get(channelId);
    if (lifecycle?.kind === "pending") {
      lifecycle.publicationInterruption.interrupt(error);
    }
  }

  /** Retries private-startup cleanup or releases an ordinary failed creation. */
  private async stopFailedPendingCreation(
    pending: PendingLifecycle,
    outcome: Extract<WorkerOutcome, { status: "failed" }>,
  ): Promise<void> {
    const { cleanup } = outcome;
    if (cleanup === undefined) {
      this.releaseLifecycle(pending);
      return;
    }
    await this.settleCleanup(pending, "worker_startup", () =>
      cleanup.retryCleanup(),
    );
  }

  /** Stops one unpublished worker while retaining failed cleanup ownership. */
  private async stopPendingWorker(
    pending: PendingLifecycle,
    worker: ManagedChannelWorker,
  ): Promise<void> {
    pending.cancelling = true;
    await this.settleCleanup(pending, "worker_stop", () => worker.stop());
  }

  /** Stops one published worker while retaining failed cleanup ownership. */
  private async stopActiveLifecycle(lifecycle: ActiveLifecycle): Promise<void> {
    cancelIdleStop(lifecycle);
    closeSubscriptions(lifecycle);
    await this.settleCleanup(lifecycle, "worker_stop", () =>
      lifecycle.worker.stop(),
    );
  }

  /**
   * Runs one cleanup step for a record. Success releases the record; failure
   * keeps it registered with a typed error so the next subscribe retries it.
   */
  private async settleCleanup(
    lifecycle: ChannelLifecycle,
    phase: CleanupPhase,
    cleanup: () => Promise<void>,
  ): Promise<void> {
    try {
      await cleanup();
    } catch (error) {
      const failure = normalizeCleanupFailure(
        lifecycle.channelId,
        error,
        phase,
      );
      lifecycle.cleanupError = failure;
      throw failure;
    }
    this.releaseLifecycle(lifecycle);
  }

  /** Forgets a record only if a newer lifecycle has not already replaced it. */
  private releaseLifecycle(lifecycle: ChannelLifecycle): void {
    if (this.lifecycles.get(lifecycle.channelId) === lifecycle) {
      this.lifecycles.delete(lifecycle.channelId);
    }
  }

  /** Observes every close path so final-viewer cleanup is counted exactly once. */
  private trackSubscription(
    lifecycle: ActiveLifecycle,
    subscription: ChannelBroadcastSubscription,
  ): void {
    lifecycle.subscriptions.add(subscription);
    void subscription.closed.then(() => {
      if (!lifecycle.subscriptions.has(subscription)) return;
      return this.transitions.run(lifecycle.channelId, () =>
        this.handleSubscriptionClosed(lifecycle, subscription),
      );
    });
  }

  /** Starts idle grace only when the current worker has truly lost its last viewer. */
  private handleSubscriptionClosed(
    lifecycle: ActiveLifecycle,
    subscription: ChannelBroadcastSubscription,
  ): void {
    if (this.lifecycles.get(lifecycle.channelId) !== lifecycle) return;
    if (!lifecycle.subscriptions.delete(subscription)) return;
    if (
      lifecycle.subscriptions.size > 0 ||
      lifecycle.stopping ||
      lifecycle.observation.terminated
    ) {
      return;
    }
    this.scheduleIdleStop(lifecycle);
  }

  /** Arms one identity-guarded deadline for a viewerless active worker. */
  private scheduleIdleStop(lifecycle: ActiveLifecycle): void {
    if (lifecycle.idleTask !== undefined) return;
    const task: ScheduledTask = this.options.timers.setTimeout(() => {
      this.runInBackground(lifecycle.channelId, () =>
        this.expireIdleStop(lifecycle, task),
      );
    }, this.options.idleGraceMs);
    lifecycle.idleTask = task;
  }

  /** Stops only the same worker that remained viewerless through its deadline. */
  private async expireIdleStop(
    lifecycle: ActiveLifecycle,
    task: ScheduledTask,
  ): Promise<void> {
    if (
      this.lifecycles.get(lifecycle.channelId) !== lifecycle ||
      lifecycle.idleTask !== task
    ) {
      return;
    }
    lifecycle.idleTask = undefined;
    if (lifecycle.subscriptions.size > 0 || lifecycle.stopping) return;
    lifecycle.stopping = true;
    await this.stopActiveLifecycle(lifecycle);
  }

  /** Tracks a resource-free lookup so stop and shutdown can reject it promptly. */
  private addAuthorizingWaiter(
    channelId: ChannelId,
    waiter: SubscriptionWaiter,
  ): void {
    const waiters = this.authorizingWaiters.get(channelId) ?? new Set();
    waiters.add(waiter);
    this.authorizingWaiters.set(channelId, waiters);
  }

  /** Releases one completed or cancelled lookup from administrative accounting. */
  private removeAuthorizingWaiter(
    channelId: ChannelId,
    waiter: SubscriptionWaiter,
  ): void {
    const waiters = this.authorizingWaiters.get(channelId);
    if (waiters === undefined) return;
    waiters.delete(waiter);
    if (waiters.size === 0) this.authorizingWaiters.delete(channelId);
  }

  /** Lets an operational gate defeat authorization without awaiting its provider. */
  private rejectAuthorizingWaiters(
    channelId: ChannelId,
    error: SignalError,
  ): void {
    const waiters = this.authorizingWaiters.get(channelId);
    if (waiters === undefined) return;
    this.authorizingWaiters.delete(channelId);
    for (const waiter of waiters) interruptWaiter(waiter, error);
  }
}

/**
 * Returns the first publication guard a ready worker fails, or undefined when
 * it may publish. Guards run in precedence order: administrative interruption,
 * authorization, worker health, remaining viewers, then worker identity.
 */
function findPublicationBlock(
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
function joinPendingWaiters(
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

/** Rejects unsafe idle configuration before any channel resources can start. */
function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
