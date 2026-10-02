import type { ChannelBroadcastSubscription } from "../channel-broadcast/channel-broadcast-subscription.js";
import type {
  ChannelAuthorization,
  ChannelAuthorizationResult,
  ChannelWorkerFactory,
  ManagedChannelWorker,
} from "../channel-worker/contracts.js";
import { WorkerCreationCleanupError } from "../channel-worker/channel-worker-errors.js";
import { assertNonNegativeSafeInteger } from "../options/safe-integer-option.js";
import type { SignalError } from "../errors.js";
import type { ChannelId } from "../playout/contracts.js";
import type { ScheduledTask, TimerScheduler } from "../runtime/clock.js";
import { RetryableAttempt } from "../runtime/retryable-attempt.js";
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
  findAuthorizationFailure,
  findPublicationBlock,
  joinPendingWaiters,
  type AuthorizationOutcome,
  type PublicationBlock,
} from "./subscription-guards.js";
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

/** Serializes channel broadcast creation, publication, and terminal cleanup. */
export class ChannelStreamManager implements ChannelStreamManagerContract {
  private readonly lifecycles = new Map<ChannelId, ChannelLifecycle>();
  private readonly transitions = new ChannelTransitionQueue();
  private readonly authorizingWaiters = new Map<
    ChannelId,
    Set<SubscriptionWaiter>
  >();
  private shuttingDown = false;
  private readonly shutdownAttempt = new RetryableAttempt();

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
    return this.shutdownAttempt.run(() => this.shutDownChannels());
  }

  /** Closes the gate, then settles every channel's runtime in one attempt. */
  private async shutDownChannels(): Promise<void> {
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
    const results = await Promise.allSettled(
      [...channelIds].map((channelId) =>
        this.transitions.run(channelId, () =>
          this.stopChannelRuntime(channelId, managerShutdown(channelId)),
        ),
      ),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
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
    const gateError = this.findWaiterBlock(channelId, waiter);
    if (gateError !== undefined) {
      rejectWaiter(waiter, gateError);
      return;
    }

    const authorizationOutcome = await this.authorizeUnlessInterrupted(
      channelId,
      waiter.interruption,
    );
    this.removeAuthorizingWaiter(channelId, waiter);
    // An interruption settles the waiter through its own path.
    if (authorizationOutcome.status === "interrupted" || waiter.settled) return;
    const authorizationFailure = findAuthorizationFailure(
      channelId,
      authorizationOutcome,
    );
    if (authorizationFailure !== undefined) {
      rejectWaiter(waiter, authorizationFailure.error);
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
      const retryGateError = this.findWaiterBlock(channelId, waiter);
      if (retryGateError !== undefined) {
        rejectWaiter(waiter, retryGateError);
        return;
      }
      lifecycle = this.lifecycles.get(channelId);
    }

    if (lifecycle?.kind === "active") {
      if (lifecycle.observation.terminated) {
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

  /** Returns why a waiter may no longer join, checked again after every await. */
  private findWaiterBlock(
    channelId: ChannelId,
    waiter: SubscriptionWaiter,
  ): SignalError | undefined {
    if (this.shuttingDown) return managerShutdown(channelId);
    if (waiter.aborted) return subscriptionAborted(channelId);
    return undefined;
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
      await this.stopCreationOutcome(pending, outcome);
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
    await this.stopCreationOutcome(pending, await pending.creation);
  }

  /** Settles what one finished creation left: a ready worker or a failed startup. */
  private async stopCreationOutcome(
    pending: PendingLifecycle,
    outcome: WorkerOutcome,
  ): Promise<void> {
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

  /**
   * Marks one published worker as stopping, so idle grace and close handling
   * stand down, then stops it while retaining failed cleanup ownership.
   */
  private async stopActiveLifecycle(lifecycle: ActiveLifecycle): Promise<void> {
    lifecycle.stopping = true;
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
