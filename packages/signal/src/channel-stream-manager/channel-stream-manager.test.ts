import { describe, expect, it, vi } from "vitest";

import { SignalError, type SignalErrorCode } from "../errors.js";
import type { ChannelId } from "../playout/contracts.js";
import { Deferred } from "../testing/deferred.js";
import { FakeClock } from "../testing/fake-clock.js";
import type {
  ChannelAuthorization,
  ChannelAuthorizationResult,
} from "../channel-worker/contracts.js";
import { WorkerCreationCleanupError } from "../channel-worker/channel-worker-errors.js";
import { ChannelStreamManager } from "./channel-stream-manager.js";
import { ControlledWorkerFactory } from "../testing/controlled-worker-factory.js";
import { expectSignalError } from "../testing/expect-signal-error.js";
import { FakeManagedWorker } from "../testing/fake-managed-worker.js";
import { RecordingLogger } from "../testing/recording-logger.js";
import { settlePromises } from "../testing/settle-promises.js";

class MutableAuthorization implements ChannelAuthorization {
  readonly calls: ChannelId[] = [];

  constructor(
    private result: ChannelAuthorizationResult = {
      status: "enabled",
      channelId: "channel-1",
    },
  ) {}

  /** Records each serialized authorization decision made by the manager. */
  async getChannelAuthorization(
    channelId: ChannelId,
  ): Promise<ChannelAuthorizationResult> {
    this.calls.push(channelId);
    return this.result;
  }

  /** Lets race tests change the state observed at publication. */
  setResult(result: ChannelAuthorizationResult): void {
    this.result = result;
  }
}

class PermissiveAuthorization implements ChannelAuthorization {
  /** Authorizes the requested channel so multi-channel lifecycle tests stay focused. */
  async getChannelAuthorization(
    channelId: ChannelId,
  ): Promise<ChannelAuthorizationResult> {
    return { status: "enabled", channelId };
  }
}

class SequencedAuthorization implements ChannelAuthorization {
  readonly calls: ChannelId[] = [];

  constructor(
    private readonly results: Array<
      ChannelAuthorizationResult | Promise<ChannelAuthorizationResult>
    >,
  ) {}

  /** Returns arranged authorization states so publication can be held in flight. */
  async getChannelAuthorization(
    channelId: ChannelId,
  ): Promise<ChannelAuthorizationResult> {
    this.calls.push(channelId);
    const result = this.results.shift();
    if (result === undefined) {
      throw new Error("No authorization result was arranged");
    }
    return result;
  }
}

/** Supplies deterministic lifecycle defaults while individual tests override policy. */
const createManager = (options: {
  authorization: ChannelAuthorization;
  workerFactory: ControlledWorkerFactory;
  timers?: FakeClock;
  idleGraceMs?: number;
  logger?: RecordingLogger;
}): ChannelStreamManager =>
  new ChannelStreamManager({
    authorization: options.authorization,
    workerFactory: options.workerFactory,
    timers: options.timers ?? new FakeClock(),
    idleGraceMs: options.idleGraceMs ?? 1_000,
    logger: options.logger ?? new RecordingLogger(),
  });

type LifecycleStop = {
  name: string;
  stop(manager: ChannelStreamManager): Promise<void>;
  rejectionCode: SignalErrorCode;
};

const lifecycleStops: readonly LifecycleStop[] = [
  {
    name: "an administrative stop",
    stop: (manager) => manager.stopChannel("channel-1", "disabled"),
    rejectionCode: "channel_disabled",
  },
  {
    name: "terminal shutdown",
    stop: (manager) => manager.shutdown(),
    rejectionCode: "manager_shutdown",
  },
];

/** Observes settlement without awaiting a promise that may never settle. */
const trackSettlement = (promise: Promise<unknown>): { settled: boolean } => {
  const state = { settled: false };
  const settle = (): void => {
    state.settled = true;
  };
  void promise.then(settle, settle);
  return state;
};

describe("ChannelStreamManager", () => {
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an unsafe idle grace value of %s",
    (idleGraceMs) => {
      expect(
        () =>
          new ChannelStreamManager({
            authorization: new MutableAuthorization(),
            workerFactory: new ControlledWorkerFactory(),
            timers: new FakeClock(),
            idleGraceMs,
            logger: new RecordingLogger(),
          }),
      ).toThrow("idleGraceMs must be a non-negative safe integer");
    },
  );

  it("deduplicates concurrent creation and publishes only a ready worker", async () => {
    const authorization = new MutableAuthorization();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization,
      workerFactory,
    });

    const subscribing = Array.from({ length: 12 }, () =>
      manager.subscribe("channel-1"),
    );
    let firstSettled = false;
    void subscribing[0]?.then(() => {
      firstSettled = true;
    });
    await settlePromises();

    expect(workerFactory.calls).toHaveLength(1);
    expect(firstSettled).toBe(false);

    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);

    const subscriptions = await Promise.all(subscribing);
    expect(new Set(subscriptions).size).toBe(12);
    expect(worker.broadcaster.subscriberCount).toBe(12);

    for (const subscription of subscriptions) subscription.close();
    await manager.shutdown();
  });

  it("shares startup failure across all remaining waiters without publishing", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const first = manager.subscribe("channel-1");
    const second = manager.subscribe("channel-1");
    const firstFailure = expectSignalError(first, "packaging_failed");
    const secondFailure = expectSignalError(second, "packaging_failed");
    await settlePromises();

    workerFactory.calls[0]?.result.reject(
      new SignalError("packaging_failed", "arranged startup failure"),
    );

    await Promise.all([firstFailure, secondFailure]);
    expect(workerFactory.calls).toHaveLength(1);
    await manager.shutdown();
  });

  it("cancels one waiter without cancelling creation for another", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const firstAbort = new AbortController();
    const first = manager.subscribe("channel-1", {
      signal: firstAbort.signal,
    });
    const second = manager.subscribe("channel-1");
    const firstFailure = expectSignalError(first, "subscription_aborted");
    await settlePromises();

    firstAbort.abort();
    await firstFailure;
    expect(workerFactory.calls[0]?.signal.aborted).toBe(false);

    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    const subscription = await second;
    expect(worker.broadcaster.subscriberCount).toBe(1);

    subscription.close();
    await manager.shutdown();
  });

  it("stops a creation that becomes ready after its final waiter cancels", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const first = manager.subscribe("channel-1", {
      signal: firstAbort.signal,
    });
    const second = manager.subscribe("channel-1", {
      signal: secondAbort.signal,
    });
    const firstFailure = expectSignalError(first, "subscription_aborted");
    const secondFailure = expectSignalError(second, "subscription_aborted");
    await settlePromises();

    firstAbort.abort();
    secondAbort.abort();
    await Promise.all([firstFailure, secondFailure]);
    expect(workerFactory.calls[0]?.signal.aborted).toBe(true);

    const losingWorker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(losingWorker);
    await settlePromises();
    expect(losingWorker.stopCalls).toBe(1);
    await manager.shutdown();
  });

  it("does not overlap a replacement with cancelled-creation cleanup", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const abort = new AbortController();
    const cancelled = manager.subscribe("channel-1", { signal: abort.signal });
    const cancelledFailure = expectSignalError(
      cancelled,
      "subscription_aborted",
    );
    await settlePromises();
    abort.abort();
    await cancelledFailure;

    const losingWorker = new FakeManagedWorker("channel-1");
    losingWorker.delayStop();
    workerFactory.calls[0]?.result.resolve(losingWorker);
    const replacement = manager.subscribe("channel-1");
    await settlePromises();

    expect(losingWorker.stopCalls).toBe(1);
    expect(workerFactory.calls).toHaveLength(1);

    losingWorker.releaseStop();
    await settlePromises();
    expect(workerFactory.calls).toHaveLength(2);

    const replacementWorker = new FakeManagedWorker("channel-1");
    workerFactory.calls[1]?.result.resolve(replacementWorker);
    const subscription = await replacement;
    subscription.close();
    await manager.shutdown();
  });

  it("revalidates authorization before reusing an active worker", async () => {
    const authorization = new MutableAuthorization();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({ authorization, workerFactory });
    const first = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    const firstSubscription = await first;

    authorization.setResult({ status: "disabled", channelId: "channel-1" });
    await expectSignalError(manager.subscribe("channel-1"), "channel_disabled");
    expect(worker.broadcaster.subscriberCount).toBe(1);
    expect(workerFactory.calls).toHaveLength(1);

    firstSubscription.close();
    await manager.shutdown();
  });

  it("lets authorization loss defeat publication and stops the losing worker", async () => {
    const authorization = new MutableAuthorization();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({ authorization, workerFactory });
    const subscribing = manager.subscribe("channel-1");
    const failure = expectSignalError(subscribing, "channel_disabled");
    await settlePromises();

    authorization.setResult({ status: "disabled", channelId: "channel-1" });
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);

    await failure;
    expect(worker.stopCalls).toBe(1);
    expect(worker.broadcaster.subscriberCount).toBe(0);
    await manager.shutdown();
  });

  it("lets caller cancellation defeat an in-flight initial authorization failure", async () => {
    const initialAuthorization = new Deferred<ChannelAuthorizationResult>();
    const authorization = new SequencedAuthorization([
      initialAuthorization.promise,
    ]);
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({ authorization, workerFactory });
    const abort = new AbortController();
    const subscribing = manager.subscribe("channel-1", {
      signal: abort.signal,
    });
    const failure = expectSignalError(subscribing, "subscription_aborted");
    await settlePromises();

    abort.abort();
    initialAuthorization.reject(new Error("arranged authorization failure"));

    await failure;
    expect(workerFactory.calls).toHaveLength(0);
    await manager.shutdown();
  });

  it("lets shutdown defeat an in-flight publication authorization failure", async () => {
    const publicationAuthorization = new Deferred<ChannelAuthorizationResult>();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new SequencedAuthorization([
        { status: "enabled", channelId: "channel-1" },
        publicationAuthorization.promise,
      ]),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    const failure = expectSignalError(subscribing, "manager_shutdown");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    await settlePromises();

    const shuttingDown = manager.shutdown();
    publicationAuthorization.reject(
      new Error("arranged publication authorization failure"),
    );

    await Promise.all([failure, shuttingDown]);
    expect(worker.stopCalls).toBe(1);
  });

  it("preserves per-waiter abort during publication authorization failure", async () => {
    const publicationAuthorization = new Deferred<ChannelAuthorizationResult>();
    const authorizationFailure = new Error(
      "arranged publication authorization failure",
    );
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new SequencedAuthorization([
        { status: "enabled", channelId: "channel-1" },
        { status: "enabled", channelId: "channel-1" },
        publicationAuthorization.promise,
      ]),
      workerFactory,
    });
    const abort = new AbortController();
    const first = manager.subscribe("channel-1", { signal: abort.signal });
    const second = manager.subscribe("channel-1");
    const firstFailure = expectSignalError(first, "subscription_aborted");
    const secondFailure = expect(second).rejects.toBe(authorizationFailure);
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    await settlePromises();

    abort.abort();
    publicationAuthorization.reject(authorizationFailure);

    await Promise.all([firstFailure, secondFailure]);
    expect(worker.stopCalls).toBe(1);
    await manager.shutdown();
  });

  it("rejects a worker that terminates between readiness and publication", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const publicationAuthorization = new Deferred<ChannelAuthorizationResult>();
    const manager = createManager({
      authorization: new SequencedAuthorization([
        { status: "enabled", channelId: "channel-1" },
        publicationAuthorization.promise,
      ]),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    const failure = expectSignalError(subscribing, "packaging_failed");
    await settlePromises();

    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    await settlePromises();
    worker.fail(new SignalError("packaging_failed", "arranged worker failure"));
    publicationAuthorization.resolve({
      status: "enabled",
      channelId: "channel-1",
    });

    await failure;
    expect(worker.stopCalls).toBe(1);
    await manager.shutdown();
  });

  it("rejects a ready worker that is no longer joinable at publication", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    const failure = expectSignalError(subscribing, "packaging_failed");
    await settlePromises();

    const worker = new FakeManagedWorker("channel-1");
    worker.loseJoinability();
    workerFactory.calls[0]?.result.resolve(worker);

    await failure;
    expect(worker.stopCalls).toBe(1);
    expect(worker.broadcaster.subscriberCount).toBe(0);
    await manager.shutdown();
  });

  it("rejects only the new viewer when an active worker is temporarily not joinable", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const first = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    const firstSubscription = await first;
    firstSubscription.stream.resume();
    await settlePromises();

    worker.loseJoinability();
    const error = await expectSignalError(
      manager.subscribe("channel-1"),
      "packaging_failed",
    );

    expect(error.details).toMatchObject({ reason: "worker_not_joinable" });
    expect(worker.stopCalls).toBe(0);
    expect(worker.broadcaster.subscriberCount).toBe(1);
    expect(firstSubscription.stream.closed).toBe(false);
    expect(workerFactory.calls).toHaveLength(1);

    await settlePromises();
    worker.restoreJoinability();
    const laterSubscription = await manager.subscribe("channel-1");
    expect(worker.broadcaster.subscriberCount).toBe(2);
    expect(workerFactory.calls).toHaveLength(1);

    laterSubscription.close();
    firstSubscription.close();
    await manager.shutdown();
  });

  it("removes a terminated active worker before creating its replacement", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const first = manager.subscribe("channel-1");
    await settlePromises();
    const firstWorker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(firstWorker);
    const firstSubscription = await first;
    firstSubscription.stream.resume();

    firstWorker.fail(
      new SignalError("packaging_failed", "arranged active worker failure"),
    );
    await settlePromises();

    const replacement = manager.subscribe("channel-1");
    await settlePromises();
    expect(firstWorker.stopCalls).toBe(1);
    expect(workerFactory.calls).toHaveLength(2);

    const replacementWorker = new FakeManagedWorker("channel-1");
    workerFactory.calls[1]?.result.resolve(replacementWorker);
    const replacementSubscription = await replacement;
    replacementSubscription.close();
    await manager.shutdown();
  });

  it("logs why a published worker failed, because no viewer request reports it", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const logger = new RecordingLogger();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
      logger,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    (await subscribing).stream.resume();
    const failure = new SignalError(
      "transition_failed",
      "arranged transition failure",
      { channelId: "channel-1" },
    );

    worker.fail(failure);
    await settlePromises();

    expect(logger.errors).toEqual([
      {
        message: "channel_worker_failed",
        context: { channelId: "channel-1", err: failure },
      },
    ]);
    await manager.shutdown();
  });

  it("logs nothing when the manager stops a published worker itself", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const logger = new RecordingLogger();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
      logger,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    workerFactory.calls[0]?.result.resolve(new FakeManagedWorker("channel-1"));
    (await subscribing).stream.resume();

    await manager.stopChannel("channel-1", "disabled");
    await settlePromises();

    expect(logger.errors).toEqual([]);
  });

  it("closes viewers on an interrupt and starts a fresh worker for the next tune", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const first = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(first);
    const viewer = await subscribing;
    viewer.stream.resume();
    const closed = new Promise((resolve) =>
      viewer.stream.once("close", resolve),
    );

    await manager.stopChannel("channel-1", "interrupted");
    await closed;
    const retuning = manager.subscribe("channel-1");
    await settlePromises();
    workerFactory.calls[1]?.result.resolve(new FakeManagedWorker("channel-1"));
    (await retuning).stream.resume();

    expect(first.stopCalls).toBe(1);
    expect(workerFactory.calls).toHaveLength(2);
    await manager.shutdown();
  });

  it("treats abort after subscription creation as caller-owned closure", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const abort = new AbortController();
    const subscribing = manager.subscribe("channel-1", {
      signal: abort.signal,
    });
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    const subscription = await subscribing;

    abort.abort();
    await settlePromises();
    expect(worker.broadcaster.subscriberCount).toBe(1);

    subscription.close();
    await manager.shutdown();
  });

  it("stops an idle worker after grace and cancels that stop when a viewer returns", async () => {
    const timers = new FakeClock();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
      timers,
      idleGraceMs: 100,
    });
    const first = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    const firstSubscription = await first;

    firstSubscription.close();
    await settlePromises();
    expect(timers.pendingTimerCount).toBe(1);

    timers.advanceBy(99);
    const secondSubscription = await manager.subscribe("channel-1");
    expect(workerFactory.calls).toHaveLength(1);
    expect(worker.stopCalls).toBe(0);
    expect(timers.pendingTimerCount).toBe(0);

    secondSubscription.close();
    await settlePromises();
    timers.advanceBy(100);
    await settlePromises();

    expect(worker.stopCalls).toBe(1);
    expect(timers.pendingTimerCount).toBe(0);
    await manager.shutdown();
  });

  it("starts idle grace exactly once after the final subscription closes", async () => {
    const timers = new FakeClock();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
      timers,
      idleGraceMs: 50,
    });
    const first = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    const firstSubscription = await first;
    const secondSubscription = await manager.subscribe("channel-1");

    firstSubscription.close();
    firstSubscription.close();
    await settlePromises();
    expect(timers.pendingTimerCount).toBe(0);

    secondSubscription.close();
    secondSubscription.close();
    await settlePromises();
    expect(timers.pendingTimerCount).toBe(1);

    timers.advanceBy(50);
    await settlePromises();
    expect(worker.stopCalls).toBe(1);
    expect(timers.pendingTimerCount).toBe(0);
    await manager.shutdown();
  });

  it("treats slow-subscriber eviction as a final viewer departure", async () => {
    const timers = new FakeClock();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
      timers,
      idleGraceMs: 25,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    await subscribing;

    worker.pushOutput("x".repeat(1_024));
    await settlePromises();
    expect(worker.broadcaster.subscriberCount).toBe(0);
    expect(timers.pendingTimerCount).toBe(1);

    timers.advanceBy(25);
    await settlePromises();
    expect(worker.stopCalls).toBe(1);
    await manager.shutdown();
  });

  it("waits for idle cleanup before creating a replacement worker", async () => {
    const timers = new FakeClock();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
      timers,
      idleGraceMs: 10,
    });
    const first = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    worker.delayStop();
    workerFactory.calls[0]?.result.resolve(worker);
    const firstSubscription = await first;

    firstSubscription.close();
    await settlePromises();
    timers.advanceBy(10);
    await settlePromises();

    const replacement = manager.subscribe("channel-1");
    await settlePromises();
    expect(worker.stopCalls).toBe(1);
    expect(workerFactory.calls).toHaveLength(1);

    worker.releaseStop();
    await settlePromises();
    expect(workerFactory.calls).toHaveLength(2);
    const replacementWorker = new FakeManagedWorker("channel-1");
    workerFactory.calls[1]?.result.resolve(replacementWorker);
    const replacementSubscription = await replacement;

    replacementSubscription.close();
    await manager.shutdown();
  });

  it("retries failed idle cleanup before the next viewer creates a replacement", async () => {
    const timers = new FakeClock();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
      timers,
      idleGraceMs: 0,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    worker.failNextStop(
      new SignalError("runtime_cleanup_failed", "arranged idle failure"),
    );
    workerFactory.calls[0]?.result.resolve(worker);
    const subscription = await subscribing;

    subscription.close();
    await settlePromises();
    timers.advanceBy(0);
    await settlePromises();
    expect(worker.stopCalls).toBe(1);

    const replacement = manager.subscribe("channel-1");
    await settlePromises();
    expect(worker.stopCalls).toBe(2);
    expect(workerFactory.calls).toHaveLength(2);

    const replacementWorker = new FakeManagedWorker("channel-1");
    workerFactory.calls[1]?.result.resolve(replacementWorker);
    const replacementSubscription = await replacement;
    replacementSubscription.close();
    await manager.shutdown();
  });

  it("keeps rejecting viewers while retried idle cleanup still fails", async () => {
    const timers = new FakeClock();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
      timers,
      idleGraceMs: 0,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    worker.failStop(
      new SignalError("runtime_cleanup_failed", "arranged idle failure"),
    );
    workerFactory.calls[0]?.result.resolve(worker);
    const subscription = await subscribing;

    subscription.close();
    await settlePromises();
    timers.advanceBy(0);
    await settlePromises();
    expect(worker.stopCalls).toBe(1);

    await expectSignalError(
      manager.subscribe("channel-1"),
      "runtime_cleanup_failed",
    );
    expect(worker.stopCalls).toBe(2);
    await expectSignalError(
      manager.subscribe("channel-1"),
      "runtime_cleanup_failed",
    );
    expect(worker.stopCalls).toBe(3);
    expect(workerFactory.calls).toHaveLength(1);
    await expectSignalError(manager.shutdown(), "runtime_cleanup_failed");
  });

  // An interrupted channel stays enabled, so a racing tune is told to retry.
  it.each([
    ["disabled", "channel_disabled"],
    ["deleted", "channel_not_found"],
    ["interrupted", "playout_unavailable"],
  ] as const)(
    "lets an administrative %s stop defeat pending publication",
    async (reason, expectedCode) => {
      const timers = new FakeClock();
      const workerFactory = new ControlledWorkerFactory();
      const manager = createManager({
        authorization: new MutableAuthorization(),
        workerFactory,
        timers,
        idleGraceMs: 100,
      });
      const subscribing = manager.subscribe("channel-1");
      const rejected = expectSignalError(subscribing, expectedCode);
      await settlePromises();

      const stopping = manager.stopChannel("channel-1", reason);
      await settlePromises();
      expect(workerFactory.calls[0]?.signal.aborted).toBe(true);
      const worker = new FakeManagedWorker("channel-1");
      workerFactory.calls[0]?.result.resolve(worker);

      await Promise.all([stopping, rejected]);
      expect(worker.stopCalls).toBe(1);
      await manager.shutdown();
    },
  );

  it.each([
    ["disabled", "channel_disabled"],
    ["deleted", "channel_not_found"],
    ["interrupted", "playout_unavailable"],
  ] as const)(
    "lets an administrative %s stop overtake initial authorization",
    async (reason, expectedCode) => {
      const authorization = new Deferred<ChannelAuthorizationResult>();
      const workerFactory = new ControlledWorkerFactory();
      const manager = createManager({
        authorization: new SequencedAuthorization([authorization.promise]),
        workerFactory,
      });
      const subscribing = manager.subscribe("channel-1");
      const rejected = expectSignalError(subscribing, expectedCode);
      await settlePromises();

      let stopSettled = false;
      const stopping = manager.stopChannel("channel-1", reason);
      void stopping.then(() => {
        stopSettled = true;
      });
      await settlePromises();

      expect(stopSettled).toBe(true);
      await rejected;
      expect(workerFactory.calls).toHaveLength(0);

      authorization.resolve({
        status: "enabled",
        channelId: "channel-1",
      });
      await stopping;
      await settlePromises();
      expect(workerFactory.calls).toHaveLength(0);
      await manager.shutdown();
    },
  );

  it("keeps the administrative reason when overtaken authorization rejects", async () => {
    const authorization = new Deferred<ChannelAuthorizationResult>();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new SequencedAuthorization([authorization.promise]),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    const rejected = expectSignalError(subscribing, "channel_disabled");
    await settlePromises();

    const stopping = manager.stopChannel("channel-1", "disabled");
    authorization.reject(new Error("arranged authorization failure"));

    await Promise.all([stopping, rejected]);
    expect(workerFactory.calls).toHaveLength(0);
    await manager.shutdown();
  });

  it("closes active streams before delayed administrative cleanup settles", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    worker.delayStop();
    workerFactory.calls[0]?.result.resolve(worker);
    const subscription = await subscribing;

    let stopSettled = false;
    const stopping = manager.stopChannel("channel-1", "disabled");
    void stopping.finally(() => {
      stopSettled = true;
    });
    await settlePromises();

    expect(subscription.stream.closed).toBe(true);
    expect(stopSettled).toBe(false);
    worker.releaseStop();
    await stopping;
    expect(stopSettled).toBe(true);
    await manager.shutdown();
  });

  it("waits for administrative cleanup before starting a replacement", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    worker.delayStop();
    workerFactory.calls[0]?.result.resolve(worker);
    await subscribing;

    const stopping = manager.stopChannel("channel-1", "disabled");
    await settlePromises();
    const replacement = manager.subscribe("channel-1");
    await settlePromises();
    expect(workerFactory.calls).toHaveLength(1);

    worker.releaseStop();
    await stopping;
    await settlePromises();
    expect(workerFactory.calls).toHaveLength(2);
    const replacementWorker = new FakeManagedWorker("channel-1");
    workerFactory.calls[1]?.result.resolve(replacementWorker);
    const replacementSubscription = await replacement;
    replacementSubscription.close();
    await manager.shutdown();
  });

  it("revalidates authorization when a queued join reaches its transition", async () => {
    const authorization = new MutableAuthorization();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({ authorization, workerFactory });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    worker.delayStop();
    workerFactory.calls[0]?.result.resolve(worker);
    await subscribing;

    const stopping = manager.stopChannel("channel-1", "disabled");
    await settlePromises();
    const replacement = manager.subscribe("channel-1");
    const rejected = expectSignalError(replacement, "channel_disabled");
    authorization.setResult({
      status: "disabled",
      channelId: "channel-1",
    });

    worker.releaseStop();
    await Promise.all([stopping, rejected]);
    expect(workerFactory.calls).toHaveLength(1);
    await manager.shutdown();
  });

  it("treats an administrative stop without runtime state as successful", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });

    await manager.stopChannel("channel-1", "disabled");
    await manager.stopChannel("channel-1", "deleted");
    expect(workerFactory.calls).toHaveLength(0);
    await manager.shutdown();
  });

  it("closes subscribers immediately and retries only unsettled administrative cleanup", async () => {
    const timers = new FakeClock();
    const authorization = new MutableAuthorization();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization,
      workerFactory,
      timers,
      idleGraceMs: 100,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    worker.failNextStop(
      new SignalError("runtime_cleanup_failed", "arranged first failure"),
    );
    workerFactory.calls[0]?.result.resolve(worker);
    const subscription = await subscribing;
    const closed = new Promise<void>((resolve) => {
      subscription.stream.once("close", resolve);
    });

    authorization.setResult({ status: "disabled", channelId: "channel-1" });
    await expectSignalError(
      manager.stopChannel("channel-1", "disabled"),
      "runtime_cleanup_failed",
    );
    await closed;
    await expectSignalError(manager.subscribe("channel-1"), "channel_disabled");
    expect(worker.stopCalls).toBe(1);

    await manager.stopChannel("channel-1", "disabled");
    expect(worker.stopCalls).toBe(2);

    authorization.setResult({ status: "enabled", channelId: "channel-1" });
    const replacement = manager.subscribe("channel-1");
    await settlePromises();
    expect(workerFactory.calls).toHaveLength(2);
    const replacementWorker = new FakeManagedWorker("channel-1");
    workerFactory.calls[1]?.result.resolve(replacementWorker);
    const replacementSubscription = await replacement;
    replacementSubscription.close();
    await manager.shutdown();
  });

  it("names the worker_stop phase and keeps the cause when a worker stop fails", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    const cause = new SignalError("packaging_failed", "FFmpeg did not exit", {
      pid: 4242,
    });
    worker.failNextStop(cause);
    workerFactory.calls[0]?.result.resolve(worker);
    (await subscribing).close();

    const failure = await manager
      .stopChannel("channel-1", "disabled")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SignalError);
    expect(failure).toMatchObject({
      code: "runtime_cleanup_failed",
      details: { channelId: "channel-1", phase: "worker_stop" },
    });
    expect((failure as Error).cause).toBe(cause);
    await manager.stopChannel("channel-1", "disabled");
    await manager.shutdown();
  });

  it("retries failed private startup cleanup from later viewers and administrative stops", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const retryCleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("arranged viewer retry failure"))
      .mockRejectedValueOnce(new Error("arranged administrative retry failure"))
      .mockResolvedValueOnce(undefined);
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();

    const initialCleanupFailure = new Error("arranged initial cleanup failure");
    workerFactory.calls[0]?.result.reject(
      new WorkerCreationCleanupError(
        "channel-1",
        initialCleanupFailure,
        retryCleanup,
      ),
    );

    const startupFailure = await expectSignalError(
      subscribing,
      "runtime_cleanup_failed",
    );
    expect(startupFailure).not.toBeInstanceOf(WorkerCreationCleanupError);
    expect(startupFailure).not.toHaveProperty("retryCleanup");
    expect(startupFailure.cause).toBe(initialCleanupFailure);
    expect(retryCleanup).toHaveBeenCalledTimes(0);
    await expectSignalError(
      manager.subscribe("channel-1"),
      "runtime_cleanup_failed",
    );
    expect(retryCleanup).toHaveBeenCalledTimes(1);
    await expectSignalError(
      manager.stopChannel("channel-1", "disabled"),
      "runtime_cleanup_failed",
    );
    expect(retryCleanup).toHaveBeenCalledTimes(2);
    expect(workerFactory.calls).toHaveLength(1);

    const replacement = manager.subscribe("channel-1");
    await settlePromises();
    expect(retryCleanup).toHaveBeenCalledTimes(3);
    expect(workerFactory.calls).toHaveLength(2);
    const replacementWorker = new FakeManagedWorker("channel-1");
    workerFactory.calls[1]?.result.resolve(replacementWorker);
    const replacementSubscription = await replacement;
    replacementSubscription.close();
    await manager.shutdown();
  });

  it("retries retained cleanup when terminal shutdown is called again", async () => {
    const timers = new FakeClock();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
      timers,
      idleGraceMs: 100,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    worker.failNextStop(
      new SignalError("runtime_cleanup_failed", "arranged first failure"),
    );
    workerFactory.calls[0]?.result.resolve(worker);
    await subscribing;

    const firstShutdown = manager.shutdown();
    expect(manager.shutdown()).toBe(firstShutdown);
    await expectSignalError(firstShutdown, "runtime_cleanup_failed");
    await expectSignalError(manager.subscribe("channel-1"), "manager_shutdown");
    const retryShutdown = manager.shutdown();
    expect(manager.shutdown()).toBe(retryShutdown);
    await retryShutdown;

    expect(worker.stopCalls).toBe(2);
    expect(timers.pendingTimerCount).toBe(0);
  });

  it("retries only failed channel records on a later terminal shutdown", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new PermissiveAuthorization(),
      workerFactory,
    });
    const first = manager.subscribe("channel-1");
    const second = manager.subscribe("channel-2");
    await settlePromises();
    const firstWorker = new FakeManagedWorker("channel-1");
    firstWorker.failNextStop(
      new SignalError("runtime_cleanup_failed", "arranged first failure"),
    );
    const secondWorker = new FakeManagedWorker("channel-2");
    workerFactory.calls
      .find(({ channelId }) => channelId === "channel-1")
      ?.result.resolve(firstWorker);
    workerFactory.calls
      .find(({ channelId }) => channelId === "channel-2")
      ?.result.resolve(secondWorker);
    await Promise.all([first, second]);

    await expectSignalError(manager.shutdown(), "runtime_cleanup_failed");
    expect(firstWorker.stopCalls).toBe(1);
    expect(secondWorker.stopCalls).toBe(1);

    await manager.shutdown();
    expect(firstWorker.stopCalls).toBe(2);
    expect(secondWorker.stopCalls).toBe(1);
  });

  it("makes shutdown terminal and cleans a late-ready pending worker", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    const subscriptionFailure = expectSignalError(
      subscribing,
      "manager_shutdown",
    );
    await settlePromises();

    const shuttingDown = manager.shutdown();
    await expectSignalError(manager.subscribe("channel-1"), "manager_shutdown");
    expect(workerFactory.calls[0]?.signal.aborted).toBe(true);

    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    await Promise.all([shuttingDown, subscriptionFailure]);
    expect(worker.stopCalls).toBe(1);
  });

  it("lets shutdown win while publication authorization is in flight", async () => {
    const publicationAuthorization = new Deferred<ChannelAuthorizationResult>();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new SequencedAuthorization([
        { status: "enabled", channelId: "channel-1" },
        publicationAuthorization.promise,
      ]),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    const failure = expectSignalError(subscribing, "manager_shutdown");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    await settlePromises();

    const shuttingDown = manager.shutdown();
    publicationAuthorization.resolve({
      status: "enabled",
      channelId: "channel-1",
    });

    await Promise.all([failure, shuttingDown]);
    expect(worker.stopCalls).toBe(1);
    expect(worker.broadcaster.subscriberCount).toBe(0);
  });

  it("stops an active worker during terminal shutdown", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization(),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    const subscription = await subscribing;
    const closed = new Promise<void>((resolve) => {
      subscription.stream.once("close", resolve);
    });
    subscription.stream.resume();

    await manager.shutdown();
    expect(worker.stopCalls).toBe(1);
    await closed;
    expect(subscription.stream.closed).toBe(true);
  });

  it("awaits every channel stop before reporting one cleanup failure", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new PermissiveAuthorization(),
      workerFactory,
    });
    const first = manager.subscribe("channel-1");
    const second = manager.subscribe("channel-2");
    await settlePromises();
    const firstWorker = new FakeManagedWorker("channel-1");
    firstWorker.failStop(
      new SignalError("runtime_cleanup_failed", "arranged cleanup failure"),
    );
    const secondWorker = new FakeManagedWorker("channel-2");
    secondWorker.delayStop();
    workerFactory.calls
      .find(({ channelId }) => channelId === "channel-1")
      ?.result.resolve(firstWorker);
    workerFactory.calls
      .find(({ channelId }) => channelId === "channel-2")
      ?.result.resolve(secondWorker);
    const subscriptions = await Promise.all([first, second]);
    for (const subscription of subscriptions) subscription.stream.resume();

    const shuttingDown = manager.shutdown();
    const shutdownFailure = expectSignalError(
      shuttingDown,
      "runtime_cleanup_failed",
    );
    let settled = false;
    void shuttingDown.catch(() => {
      settled = true;
    });
    await settlePromises();

    expect(firstWorker.stopCalls).toBe(1);
    expect(secondWorker.stopCalls).toBe(1);
    expect(settled).toBe(false);

    secondWorker.releaseStop();
    await shutdownFailure;
    expect(settled).toBe(true);
  });

  it.each(lifecycleStops)(
    "lets $name defeat publication authorization that never settles",
    async ({ stop, rejectionCode }) => {
      const workerFactory = new ControlledWorkerFactory();
      const manager = createManager({
        authorization: new SequencedAuthorization([
          { status: "enabled", channelId: "channel-1" },
          new Deferred<ChannelAuthorizationResult>().promise,
        ]),
        workerFactory,
      });
      const subscribing = manager.subscribe("channel-1");
      const rejected = trackSettlement(subscribing);
      void subscribing.catch(() => undefined);
      await settlePromises();
      const worker = new FakeManagedWorker("channel-1");
      workerFactory.calls[0]?.result.resolve(worker);
      await settlePromises();

      const stopping = trackSettlement(stop(manager));
      await settlePromises();

      expect(stopping.settled).toBe(true);
      expect(rejected.settled).toBe(true);
      await expectSignalError(subscribing, rejectionCode);
      expect(worker.stopCalls).toBe(1);
      expect(worker.broadcaster.subscriberCount).toBe(0);
    },
  );

  it.each(lifecycleStops)(
    "lets $name bypass armed idle grace and cancel its timer",
    async ({ stop }) => {
      const timers = new FakeClock();
      const workerFactory = new ControlledWorkerFactory();
      const manager = createManager({
        authorization: new MutableAuthorization(),
        workerFactory,
        timers,
        idleGraceMs: 100,
      });
      const subscribing = manager.subscribe("channel-1");
      await settlePromises();
      const worker = new FakeManagedWorker("channel-1");
      workerFactory.calls[0]?.result.resolve(worker);
      const subscription = await subscribing;
      subscription.close();
      await settlePromises();
      expect(timers.pendingTimerCount).toBe(1);

      await stop(manager);
      expect(worker.stopCalls).toBe(1);
      expect(timers.pendingTimerCount).toBe(0);

      timers.advanceBy(100);
      await settlePromises();
      expect(worker.stopCalls).toBe(1);
      await manager.shutdown();
    },
  );

  it("lets a join still authorizing at idle expiry keep the same worker", async () => {
    const timers = new FakeClock();
    const returningAuthorization = new Deferred<ChannelAuthorizationResult>();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new SequencedAuthorization([
        { status: "enabled", channelId: "channel-1" },
        { status: "enabled", channelId: "channel-1" },
        returningAuthorization.promise,
      ]),
      workerFactory,
      timers,
      idleGraceMs: 100,
    });
    const first = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    const firstSubscription = await first;
    firstSubscription.close();
    await settlePromises();

    const returning = manager.subscribe("channel-1");
    await settlePromises();
    timers.advanceBy(100);
    await settlePromises();
    expect(worker.stopCalls).toBe(0);

    returningAuthorization.resolve({
      status: "enabled",
      channelId: "channel-1",
    });
    const returningSubscription = await returning;
    await settlePromises();

    expect(worker.stopCalls).toBe(0);
    expect(workerFactory.calls).toHaveLength(1);
    expect(worker.broadcaster.subscriberCount).toBe(1);
    expect(timers.pendingTimerCount).toBe(0);
    returningSubscription.close();
    await manager.shutdown();
  });

  it("lets shutdown overtake initial authorization without awaiting the provider", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new SequencedAuthorization([
        new Deferred<ChannelAuthorizationResult>().promise,
      ]),
      workerFactory,
    });
    const subscribing = manager.subscribe("channel-1");
    const rejected = expectSignalError(subscribing, "manager_shutdown");
    await settlePromises();

    const shuttingDown = trackSettlement(manager.shutdown());
    await settlePromises();

    expect(shuttingDown.settled).toBe(true);
    await rejected;
    expect(workerFactory.calls).toHaveLength(0);
  });

  it("lets shutdown overtake a join authorizing against an active worker", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new SequencedAuthorization([
        { status: "enabled", channelId: "channel-1" },
        { status: "enabled", channelId: "channel-1" },
        new Deferred<ChannelAuthorizationResult>().promise,
      ]),
      workerFactory,
    });
    const first = manager.subscribe("channel-1");
    await settlePromises();
    const worker = new FakeManagedWorker("channel-1");
    workerFactory.calls[0]?.result.resolve(worker);
    const firstSubscription = await first;
    firstSubscription.stream.resume();
    const joining = manager.subscribe("channel-1");
    const rejected = expectSignalError(joining, "manager_shutdown");
    await settlePromises();

    const shuttingDown = trackSettlement(manager.shutdown());
    await settlePromises();

    expect(shuttingDown.settled).toBe(true);
    await rejected;
    expect(worker.stopCalls).toBe(1);
    expect(firstSubscription.stream.closed).toBe(true);
    expect(workerFactory.calls).toHaveLength(1);
  });

  it.each(lifecycleStops)(
    "retains a failed unpublished-worker stop until $name retries it once",
    async ({ stop }) => {
      const authorization = new MutableAuthorization();
      const workerFactory = new ControlledWorkerFactory();
      const manager = createManager({ authorization, workerFactory });
      const subscribing = manager.subscribe("channel-1");
      const rejected = expectSignalError(subscribing, "channel_disabled");
      await settlePromises();

      authorization.setResult({ status: "disabled", channelId: "channel-1" });
      const worker = new FakeManagedWorker("channel-1");
      worker.failNextStop(
        new SignalError("runtime_cleanup_failed", "arranged pending failure"),
      );
      workerFactory.calls[0]?.result.resolve(worker);
      await rejected;
      await settlePromises();
      expect(worker.stopCalls).toBe(1);

      await expectSignalError(
        manager.subscribe("channel-1"),
        "channel_disabled",
      );
      expect(worker.stopCalls).toBe(1);
      expect(workerFactory.calls).toHaveLength(1);

      await stop(manager);
      expect(worker.stopCalls).toBe(2);
      await stop(manager);
      expect(worker.stopCalls).toBe(2);
      await manager.shutdown();
    },
  );

  it("rejects mismatched authorization without creating a worker", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({
      authorization: new MutableAuthorization({
        status: "enabled",
        channelId: "different-channel",
      }),
      workerFactory,
    });

    await expectSignalError(
      manager.subscribe("channel-1"),
      "invalid_channel_authorization",
    );
    expect(workerFactory.calls).toHaveLength(0);
    await manager.shutdown();
  });

  it("rejects an already-aborted request without authorization or creation", async () => {
    const authorization = new MutableAuthorization();
    const workerFactory = new ControlledWorkerFactory();
    const manager = createManager({ authorization, workerFactory });
    const abort = new AbortController();
    abort.abort();

    await expectSignalError(
      manager.subscribe("channel-1", { signal: abort.signal }),
      "subscription_aborted",
    );
    expect(authorization.calls).toHaveLength(0);
    expect(workerFactory.calls).toHaveLength(0);
    await manager.shutdown();
  });
});
