import type { ChannelBroadcastSubscription } from "../channel-broadcast/channel-broadcast-subscription.js";
import type {
  ChannelAuthorization,
  ChannelAuthorizationResult,
} from "../channel-worker/contracts.js";
import type {
  ChannelWorkerFactory,
  ManagedChannelWorker,
} from "../channel-worker/worker-factory.js";
import { SignalError } from "../errors.js";
import type { ChannelId } from "../playout/contracts.js";
import type {
  ChannelStreamManagerContract,
  ChannelSubscribeOptions,
  ChannelSubscription,
} from "./contracts.js";

type ChannelStreamManagerOptions = {
  authorization: ChannelAuthorization;
  workerFactory: ChannelWorkerFactory<ManagedChannelWorker>;
};

type WorkerOutcome =
  | { status: "ready"; worker: ManagedChannelWorker }
  | { status: "failed"; error: unknown };

type SubscriptionWaiter = {
  readonly signal: AbortSignal | undefined;
  readonly promise: Promise<ChannelSubscription>;
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
  worker?: ManagedChannelWorker;
  cancelling: boolean;
  cleanupError?: unknown;
};

type ActiveLifecycle = {
  readonly kind: "active";
  readonly channelId: ChannelId;
  readonly worker: ManagedChannelWorker;
  readonly observation: WorkerObservation;
  stopping: boolean;
  cleanupError?: unknown;
};

type ChannelLifecycle = PendingLifecycle | ActiveLifecycle;

/** Serializes channel broadcast creation, publication, and terminal cleanup. */
export class ChannelStreamManager implements ChannelStreamManagerContract {
  private readonly lifecycles = new Map<ChannelId, ChannelLifecycle>();
  private readonly transitionTails = new Map<ChannelId, Promise<void>>();
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;

  /** Retains provider-neutral ports without starting any channel resources. */
  constructor(private readonly options: ChannelStreamManagerOptions) {}

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
      void this.serialize(channelId, () =>
        this.cancelWaiter(channelId, waiter),
      ).catch(() => undefined);
    };
    waiter.signal?.addEventListener("abort", waiter.abortListener, {
      once: true,
    });
    if (waiter.signal?.aborted === true) waiter.abortListener();

    void this.serialize(channelId, () =>
      this.joinSubscription(channelId, waiter),
    ).catch((error: unknown) => this.rejectWaiter(waiter, error));
    return waiter.promise;
  }

  /** Permanently rejects new work and settles every worker known to this manager. */
  shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;

    this.shuttingDown = true;
    const channelIds = new Set([
      ...this.lifecycles.keys(),
      ...this.transitionTails.keys(),
    ]);
    this.shutdownPromise = Promise.allSettled(
      [...channelIds].map((channelId) =>
        this.serialize(channelId, () => this.stopForShutdown(channelId)),
      ),
    ).then((results) => {
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure !== undefined) throw failure.reason;
    });
    return this.shutdownPromise;
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

    let authorization: ChannelAuthorizationResult;
    try {
      authorization =
        await this.options.authorization.getChannelAuthorization(channelId);
    } catch (error) {
      if (this.shuttingDown) {
        this.rejectWaiter(waiter, managerShutdown(channelId));
      } else if (waiter.aborted) {
        this.rejectWaiter(waiter, subscriptionAborted(channelId));
      } else {
        this.rejectWaiter(waiter, error);
      }
      return;
    }
    if (waiter.settled) return;
    if (this.shuttingDown) {
      this.rejectWaiter(waiter, managerShutdown(channelId));
      return;
    }
    if (waiter.aborted) {
      this.rejectWaiter(waiter, subscriptionAborted(channelId));
      return;
    }
    const authorizationError = validateAuthorization(channelId, authorization);
    if (authorizationError !== undefined) {
      this.rejectWaiter(waiter, authorizationError);
      return;
    }

    const lifecycle = this.lifecycles.get(channelId);
    if (lifecycle?.kind === "active") {
      if (lifecycle.stopping || lifecycle.cleanupError !== undefined) {
        this.rejectWaiter(waiter, cleanupFailed(channelId));
        return;
      }
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
        this.resolveWaiter(waiter, subscription);
        return;
      }

      this.rejectWaiter(waiter, workerUnavailable(channelId));
      return;
    }

    if (lifecycle?.kind === "pending") {
      if (lifecycle.cancelling || lifecycle.cleanupError !== undefined) {
        this.rejectWaiter(waiter, cleanupFailed(channelId));
        return;
      }
      lifecycle.waiters.add(waiter);
      return;
    }

    const pending = this.startPendingLifecycle(channelId, waiter);
    this.lifecycles.set(channelId, pending);
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
      (error: unknown) => ({ status: "failed" as const, error }),
    );
    const pending: PendingLifecycle = {
      kind: "pending",
      channelId,
      controller,
      creation,
      waiters: new Set([firstWaiter]),
      observation: { terminated: false },
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
        this.lifecycles.delete(pending.channelId);
      }
      return;
    }
    if (outcome.status === "failed") {
      this.rejectAbortedWaiters(pending);
      this.rejectAll(
        pending,
        normalizeWorkerFailure(pending.channelId, outcome.error),
      );
      this.lifecycles.delete(pending.channelId);
      return;
    }
    if (pending.cancelling) return;

    let authorization: ChannelAuthorizationResult;
    try {
      authorization = await this.options.authorization.getChannelAuthorization(
        pending.channelId,
      );
    } catch (error) {
      this.rejectAbortedWaiters(pending);
      this.rejectAll(
        pending,
        this.shuttingDown ? managerShutdown(pending.channelId) : error,
      );
      await this.stopPendingWorker(pending, outcome.worker);
      return;
    }
    this.rejectAbortedWaiters(pending);
    if (this.shuttingDown) {
      this.rejectAll(pending, managerShutdown(pending.channelId));
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
      authorization,
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
      stopping: false,
    };
    this.lifecycles.set(pending.channelId, active);
    for (const { waiter, subscription } of created) {
      this.resolveWaiter(waiter, subscription);
    }
    pending.waiters.clear();
  }

  /** Removes one cancelled waiter and stops creation only when none remain. */
  private async cancelWaiter(
    channelId: ChannelId,
    waiter: SubscriptionWaiter,
  ): Promise<void> {
    if (!waiter.settled) {
      this.rejectWaiter(waiter, subscriptionAborted(channelId));
    }
    const lifecycle = this.lifecycles.get(channelId);
    if (lifecycle?.kind !== "pending" || !lifecycle.waiters.delete(waiter)) {
      return;
    }
    if (lifecycle.waiters.size > 0 || lifecycle.cancelling) return;

    lifecycle.cancelling = true;
    lifecycle.controller.abort();
    const outcome = await lifecycle.creation;
    if (outcome.status === "ready") {
      await this.stopPendingWorker(lifecycle, outcome.worker);
    } else if (this.lifecycles.get(channelId) === lifecycle) {
      this.lifecycles.delete(channelId);
    }
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

  /** Stops whichever lifecycle record remains when terminal shutdown reaches it. */
  private async stopForShutdown(channelId: ChannelId): Promise<void> {
    const lifecycle = this.lifecycles.get(channelId);
    if (lifecycle === undefined) return;
    if (lifecycle.kind === "active") {
      lifecycle.stopping = true;
      await this.stopActiveLifecycle(lifecycle);
      return;
    }

    lifecycle.cancelling = true;
    lifecycle.controller.abort();
    this.rejectAll(lifecycle, managerShutdown(channelId));
    const outcome = await lifecycle.creation;
    if (outcome.status === "ready") {
      await this.stopPendingWorker(lifecycle, outcome.worker);
    } else if (this.lifecycles.get(channelId) === lifecycle) {
      this.lifecycles.delete(channelId);
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
      pending.cleanupError = error;
      throw error;
    }
  }

  /** Stops one published worker while retaining failed cleanup ownership. */
  private async stopActiveLifecycle(lifecycle: ActiveLifecycle): Promise<void> {
    try {
      await lifecycle.worker.stop();
      if (this.lifecycles.get(lifecycle.channelId) === lifecycle) {
        this.lifecycles.delete(lifecycle.channelId);
      }
    } catch (error) {
      lifecycle.cleanupError = error;
      throw error;
    }
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
    resolve,
    reject,
    aborted: signal?.aborted === true,
    settled: false,
  };
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

/** Blocks replacement while a failed cleanup record still owns resources. */
function cleanupFailed(channelId: ChannelId): SignalError {
  return new SignalError(
    "runtime_cleanup_failed",
    `Channel ${channelId} runtime cleanup has not settled`,
    { channelId },
  );
}
