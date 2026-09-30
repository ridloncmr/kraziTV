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
import { SignalError } from "../errors.js";
import type { ChannelId } from "../playout/contracts.js";
import type { ScheduledTask, TimerScheduler } from "../runtime/clock.js";
import type {
  ChannelStopReason,
  ChannelStreamManagerContract,
  ChannelSubscribeOptions,
  ChannelSubscription,
} from "./contracts.js";

type ChannelStreamManagerOptions = {
  authorization: ChannelAuthorization;
  workerFactory: ChannelWorkerFactory<ManagedChannelWorker>;
  timers: TimerScheduler;
  idleGraceMs: number;
};

type WorkerOutcome =
  | { status: "ready"; worker: ManagedChannelWorker }
  | {
      status: "failed";
      error: unknown;
      cleanup?: WorkerCreationCleanupError;
    };

type Interruption = {
  readonly promise: Promise<SignalError>;
  readonly error: SignalError | undefined;
  interrupt(error: SignalError): void;
};

type AuthorizationOutcome =
  | { status: "resolved"; authorization: ChannelAuthorizationResult }
  | { status: "failed"; error: unknown }
  | { status: "interrupted"; error: SignalError };

type SubscriptionWaiter = {
  readonly signal: AbortSignal | undefined;
  readonly promise: Promise<ChannelSubscription>;
  readonly interruption: Interruption;
  readonly resolve: (subscription: ChannelSubscription) => void;
  readonly reject: (error: unknown) => void;
  abortListener?: () => void;
  aborted: boolean;
  settled: boolean;
};

type WorkerObservation = {
  terminated: boolean;
  failure?: unknown;
};

type PendingLifecycle = {
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

type ActiveLifecycle = {
  readonly kind: "active";
  readonly channelId: ChannelId;
  readonly worker: ManagedChannelWorker;
  readonly observation: WorkerObservation;
  readonly subscriptions: Set<ChannelBroadcastSubscription>;
  idleTask?: ScheduledTask;
  stopping: boolean;
  cleanupError?: unknown;
};

type ChannelLifecycle = PendingLifecycle | ActiveLifecycle;

/** Serializes channel broadcast creation, publication, and terminal cleanup. */
export class ChannelStreamManager implements ChannelStreamManagerContract {
  private readonly lifecycles = new Map<ChannelId, ChannelLifecycle>();
  private readonly transitionTails = new Map<ChannelId, Promise<void>>();
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
      void this.serialize(channelId, () =>
        this.cancelWaiter(channelId, waiter),
      ).catch(() => undefined);
    };
    waiter.signal?.addEventListener("abort", waiter.abortListener, {
      once: true,
    });
    if (waiter.signal?.aborted === true) waiter.abortListener();
    if (waiter.aborted) return waiter.promise;

    this.addAuthorizingWaiter(channelId, waiter);
    void this.serialize(channelId, () =>
      this.joinSubscription(channelId, waiter),
    ).catch((error: unknown) => this.rejectWaiter(waiter, error));
    return waiter.promise;
  }

  /** Serializes an immediate operational stop without making the manager terminal. */
  stopChannel(channelId: ChannelId, reason: ChannelStopReason): Promise<void> {
    const error = administrativeStop(channelId, reason);
    this.rejectAuthorizingWaiters(channelId, error);
    this.interruptPublication(channelId, error);
    return this.serialize(channelId, () =>
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
      ...this.transitionTails.keys(),
    ]);
    const attempt = Promise.allSettled(
      [...channelIds].map((channelId) =>
        this.serialize(channelId, () =>
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

  /** Runs one state change after every earlier change for the same channel. */
  private serialize<T>(
    channelId: ChannelId,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const previous = this.transitionTails.get(channelId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.transitionTails.set(channelId, tail);
    void tail.then(() => {
      if (this.transitionTails.get(channelId) === tail) {
        this.transitionTails.delete(channelId);
      }
    });
    return result;
  }

  /** Rechecks caller state around authorization before joining shared runtime state. */
  private async joinSubscription(
    channelId: ChannelId,
    waiter: SubscriptionWaiter,
  ): Promise<void> {
    if (waiter.settled) return;
    if (this.shuttingDown) {
      this.rejectWaiter(waiter, managerShutdown(channelId));
      return;
    }
    if (waiter.aborted) {
      this.rejectWaiter(waiter, subscriptionAborted(channelId));
      return;
    }

    const authorizationOutcome = await this.authorizeUnlessInterrupted(
      channelId,
      waiter.interruption,
    );
    this.removeAuthorizingWaiter(channelId, waiter);
    if (authorizationOutcome.status === "interrupted" || waiter.settled) return;
    if (authorizationOutcome.status === "failed") {
      this.rejectWaiter(waiter, authorizationOutcome.error);
      return;
    }
    const authorizationError = validateAuthorization(
      channelId,
      authorizationOutcome.authorization,
    );
    if (authorizationError !== undefined) {
      this.rejectWaiter(waiter, authorizationError);
      return;
    }

    let lifecycle = this.lifecycles.get(channelId);
    if (lifecycle !== undefined && hasRetainedCleanup(lifecycle)) {
      try {
        await this.stopChannelRuntime(channelId, cleanupFailed(channelId));
      } catch {
        this.rejectWaiter(waiter, cleanupFailed(channelId));
        return;
      }
      if (this.shuttingDown) {
        this.rejectWaiter(waiter, managerShutdown(channelId));
        return;
      }
      if (waiter.aborted) {
        this.rejectWaiter(waiter, subscriptionAborted(channelId));
        return;
      }
      lifecycle = this.lifecycles.get(channelId);
    }

    if (lifecycle?.kind === "active") {
      if (lifecycle.observation.terminated) {
        lifecycle.stopping = true;
        this.rejectWaiter(
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
        this.rejectWaiter(waiter, normalizeWorkerFailure(channelId, error));
        await this.stopActiveLifecycle(lifecycle);
        return;
      }
      if (subscription !== undefined) {
        this.trackSubscription(lifecycle, subscription);
        this.cancelIdleStop(lifecycle);
        this.resolveWaiter(waiter, subscription);
        return;
      }

      this.rejectWaiter(waiter, workerUnavailable(channelId));
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
        pending.worker = outcome.worker;
        void outcome.worker.completion.then(
          () => {
            pending.observation.terminated = true;
            void this.serialize(channelId, () =>
              this.handleWorkerTermination(pending, outcome.worker),
            ).catch(() => undefined);
          },
          (error: unknown) => {
            pending.observation.terminated = true;
            pending.observation.failure = error;
            void this.serialize(channelId, () =>
              this.handleWorkerTermination(pending, outcome.worker),
            ).catch(() => undefined);
          },
        );
      }
      void this.serialize(channelId, () =>
        this.publishCreation(pending, outcome),
      ).catch(() => undefined);
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
      this.rejectAll(pending, managerShutdown(pending.channelId));
      if (outcome.status === "ready") {
        await this.stopPendingWorker(pending, outcome.worker);
      } else {
        await this.stopFailedPendingCreation(pending, outcome);
      }
      return;
    }
    if (outcome.status === "failed") {
      this.rejectAbortedWaiters(pending);
      this.rejectAll(
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
    this.rejectAbortedWaiters(pending);
    const interruptionError = pending.publicationInterruption.error;
    if (interruptionError !== undefined) {
      this.rejectAll(pending, interruptionError);
      await this.stopPendingWorker(pending, outcome.worker);
      return;
    }
    if (authorizationOutcome.status !== "resolved") {
      this.rejectAll(pending, authorizationOutcome.error);
      await this.stopPendingWorker(pending, outcome.worker);
      return;
    }
    if (pending.observation.terminated) {
      this.rejectAll(
        pending,
        normalizeWorkerFailure(pending.channelId, pending.observation.failure),
      );
      await this.stopPendingWorker(pending, outcome.worker);
      return;
    }
    const authorizationError = validateAuthorization(
      pending.channelId,
      authorizationOutcome.authorization,
    );
    if (authorizationError !== undefined) {
      this.rejectAll(pending, authorizationError);
      await this.stopPendingWorker(pending, outcome.worker);
      return;
    }
    if (pending.waiters.size === 0) {
      pending.cancelling = true;
      pending.controller.abort();
      await this.stopPendingWorker(pending, outcome.worker);
      return;
    }
    if (outcome.worker.channelId !== pending.channelId) {
      this.rejectAll(pending, workerChannelMismatch(pending.channelId));
      await this.stopPendingWorker(pending, outcome.worker);
      return;
    }

    const created: Array<{
      waiter: SubscriptionWaiter;
      subscription: ChannelBroadcastSubscription;
    }> = [];
    try {
      for (const waiter of pending.waiters) {
        if (waiter.aborted) {
          this.rejectWaiter(waiter, subscriptionAborted(pending.channelId));
          continue;
        }
        const subscription = outcome.worker.trySubscribe();
        if (subscription === undefined)
          throw workerUnavailable(pending.channelId);
        created.push({ waiter, subscription });
      }
    } catch (error) {
      for (const { subscription } of created) subscription.close();
      this.rejectAll(pending, normalizeWorkerFailure(pending.channelId, error));
      await this.stopPendingWorker(pending, outcome.worker);
      return;
    }

    if (created.length === 0) {
      pending.cancelling = true;
      pending.controller.abort();
      await this.stopPendingWorker(pending, outcome.worker);
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
    for (const { waiter, subscription } of created) {
      this.trackSubscription(active, subscription);
      this.resolveWaiter(waiter, subscription);
    }
    pending.waiters.clear();
  }

  /** Removes one cancelled waiter and stops creation only when none remain. */
  private async cancelWaiter(
    channelId: ChannelId,
    waiter: SubscriptionWaiter,
  ): Promise<void> {
    this.removeAuthorizingWaiter(channelId, waiter);
    if (!waiter.settled) {
      this.rejectWaiter(waiter, subscriptionAborted(channelId));
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
      this.rejectAll(
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

    this.rejectAll(lifecycle, waiterError);
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
    if (outcome.cleanup === undefined) {
      if (this.lifecycles.get(pending.channelId) === pending) {
        this.lifecycles.delete(pending.channelId);
      }
      return;
    }
    try {
      await outcome.cleanup.retryCleanup();
      if (this.lifecycles.get(pending.channelId) === pending) {
        this.lifecycles.delete(pending.channelId);
      }
    } catch (error) {
      const failure = normalizeCleanupFailure(pending.channelId, error);
      pending.cleanupError = failure;
      throw failure;
    }
  }

  /** Stops one unpublished worker while retaining failed cleanup ownership. */
  private async stopPendingWorker(
    pending: PendingLifecycle,
    worker: ManagedChannelWorker,
  ): Promise<void> {
    pending.cancelling = true;
    try {
      await worker.stop();
      if (this.lifecycles.get(pending.channelId) === pending) {
        this.lifecycles.delete(pending.channelId);
      }
    } catch (error) {
      const failure = normalizeCleanupFailure(pending.channelId, error);
      pending.cleanupError = failure;
      throw failure;
    }
  }

  /** Stops one published worker while retaining failed cleanup ownership. */
  private async stopActiveLifecycle(lifecycle: ActiveLifecycle): Promise<void> {
    this.cancelIdleStop(lifecycle);
    this.closeSubscriptions(lifecycle);
    try {
      await lifecycle.worker.stop();
      if (this.lifecycles.get(lifecycle.channelId) === lifecycle) {
        this.lifecycles.delete(lifecycle.channelId);
      }
    } catch (error) {
      const failure = normalizeCleanupFailure(lifecycle.channelId, error);
      lifecycle.cleanupError = failure;
      throw failure;
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
      return this.serialize(lifecycle.channelId, () =>
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
    let task!: ScheduledTask;
    task = this.options.timers.setTimeout(() => {
      void this.serialize(lifecycle.channelId, () =>
        this.expireIdleStop(lifecycle, task),
      ).catch(() => undefined);
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

  /** Cancels one pending idle transition before another lifecycle event wins. */
  private cancelIdleStop(lifecycle: ActiveLifecycle): void {
    lifecycle.idleTask?.cancel();
    lifecycle.idleTask = undefined;
  }

  /** Ends viewer streams synchronously before process cleanup can block or fail. */
  private closeSubscriptions(lifecycle: ActiveLifecycle): void {
    const subscriptions = [...lifecycle.subscriptions];
    lifecycle.subscriptions.clear();
    for (const subscription of subscriptions) subscription.close();
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
    for (const waiter of waiters) this.interruptWaiter(waiter, error);
  }

  /** Releases an in-flight authorization await before rejecting its caller. */
  private interruptWaiter(
    waiter: SubscriptionWaiter,
    error: SignalError,
  ): void {
    waiter.interruption.interrupt(error);
    this.rejectWaiter(waiter, error);
  }

  /** Rejects waiters whose cancellation became observable before publication. */
  private rejectAbortedWaiters(pending: PendingLifecycle): void {
    for (const waiter of [...pending.waiters]) {
      if (!waiter.aborted) continue;
      pending.waiters.delete(waiter);
      this.rejectWaiter(waiter, subscriptionAborted(pending.channelId));
    }
  }

  /** Resolves one waiter and transfers lifetime ownership to its caller. */
  private resolveWaiter(
    waiter: SubscriptionWaiter,
    subscription: ChannelSubscription,
  ): void {
    if (waiter.settled) {
      subscription.close();
      return;
    }
    waiter.settled = true;
    this.detachAbort(waiter);
    waiter.resolve(subscription);
  }

  /** Rejects one waiter exactly once and releases its abort listener. */
  private rejectWaiter(waiter: SubscriptionWaiter, error: unknown): void {
    if (waiter.settled) return;
    waiter.settled = true;
    this.detachAbort(waiter);
    waiter.reject(error);
  }

  /** Rejects and removes every waiter still owned by one pending creation. */
  private rejectAll(pending: PendingLifecycle, error: unknown): void {
    for (const waiter of pending.waiters) this.rejectWaiter(waiter, error);
    pending.waiters.clear();
  }

  /** Removes the per-call cancellation listener once it can no longer win. */
  private detachAbort(waiter: SubscriptionWaiter): void {
    if (waiter.abortListener !== undefined) {
      waiter.signal?.removeEventListener("abort", waiter.abortListener);
    }
  }
}

/** Creates one externally settled waiter without exposing manager internals. */
function createWaiter(signal: AbortSignal | undefined): SubscriptionWaiter {
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
function createInterruption(): Interruption {
  let resolve!: (error: SignalError) => void;
  let error: SignalError | undefined;
  const promise = new Promise<SignalError>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
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

/** Identifies a record whose failed cleanup must settle before the channel is reused. */
function hasRetainedCleanup(lifecycle: ChannelLifecycle): boolean {
  if (lifecycle.cleanupError !== undefined) return true;
  return lifecycle.kind === "active"
    ? lifecycle.stopping
    : lifecycle.cancelling;
}

/** Maps a channel-level authorization projection to its safe failure. */
function validateAuthorization(
  channelId: ChannelId,
  authorization: ChannelAuthorizationResult,
): SignalError | undefined {
  if (authorization.channelId !== channelId) {
    return new SignalError(
      "invalid_channel_authorization",
      `Channel authorization returned a mismatched channel for ${channelId}`,
      { channelId, returnedChannelId: authorization.channelId },
    );
  }
  if (authorization.status === "not_found") {
    return new SignalError(
      "channel_not_found",
      `Channel ${channelId} was not found`,
      { channelId },
    );
  }
  if (authorization.status === "disabled") {
    return new SignalError(
      "channel_disabled",
      `Channel ${channelId} is disabled`,
      { channelId },
    );
  }
  return undefined;
}

/** Preserves typed worker failures and classifies unknown creation failures. */
function normalizeWorkerFailure(
  channelId: ChannelId,
  cause: unknown,
): SignalError {
  if (cause instanceof SignalError) return cause;
  return new SignalError(
    "packaging_failed",
    `Channel ${channelId} worker failed before publication`,
    { channelId },
    cause === undefined ? undefined : { cause },
  );
}

/** Reports a worker that can no longer initialize a new viewer. */
function workerUnavailable(channelId: ChannelId): SignalError {
  return new SignalError(
    "packaging_failed",
    `Channel ${channelId} worker is no longer joinable`,
    { channelId, reason: "worker_not_joinable" },
  );
}

/** Rejects a worker factory result that belongs to a different channel. */
function workerChannelMismatch(channelId: ChannelId): SignalError {
  return new SignalError(
    "packaging_failed",
    `Channel ${channelId} worker returned for a different channel`,
    { channelId, reason: "worker_channel_mismatch" },
  );
}

/** Creates the stable per-waiter cancellation failure. */
function subscriptionAborted(channelId: ChannelId): SignalError {
  return new SignalError(
    "subscription_aborted",
    `Channel ${channelId} subscription was cancelled`,
    { channelId },
  );
}

/** Creates the terminal manager gate failure. */
function managerShutdown(channelId: ChannelId): SignalError {
  return new SignalError(
    "manager_shutdown",
    `Channel ${channelId} cannot be subscribed after manager shutdown`,
    { channelId },
  );
}

/**
 * Blocks replacement while a failed cleanup record still owns resources. Only
 * the diagnostic cause is carried, never a retry handle the manager must own.
 */
function cleanupFailed(channelId: ChannelId, cause?: unknown): SignalError {
  return new SignalError(
    "runtime_cleanup_failed",
    `Channel ${channelId} runtime cleanup has not settled`,
    { channelId },
    cause === undefined ? undefined : { cause },
  );
}

/** Maps an administrative race to the state already committed by persistence. */
function administrativeStop(
  channelId: ChannelId,
  reason: ChannelStopReason,
): SignalError {
  return reason === "disabled"
    ? new SignalError(
        "channel_disabled",
        `Channel ${channelId} was disabled before the subscription completed`,
        { channelId, stopReason: reason },
      )
    : new SignalError(
        "channel_not_found",
        `Channel ${channelId} was deleted before the subscription completed`,
        { channelId, stopReason: reason },
      );
}

/** Keeps cleanup failures typed while preserving the original diagnostic cause. */
function normalizeCleanupFailure(
  channelId: ChannelId,
  cause: unknown,
): SignalError {
  if (cause instanceof SignalError && cause.code === "runtime_cleanup_failed") {
    return cause;
  }
  return new SignalError(
    "runtime_cleanup_failed",
    `Channel ${channelId} runtime cleanup did not settle`,
    { channelId },
    { cause },
  );
}

/** Rejects unsafe idle configuration before any channel resources can start. */
function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
