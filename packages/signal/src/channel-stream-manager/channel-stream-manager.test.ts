import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { ChannelBroadcaster } from "../channel-broadcast/channel-broadcaster.js";
import { SignalError, type SignalErrorCode } from "../errors.js";
import type { ChannelId } from "../playout/contracts.js";
import { Deferred } from "../testing/deferred.js";
import type {
  ChannelAuthorization,
  ChannelAuthorizationResult,
} from "../channel-worker/contracts.js";
import type { ManagedChannelWorker } from "../channel-worker/worker-factory.js";
import { ChannelStreamManager } from "./channel-stream-manager.js";

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

class FakeManagedWorker implements ManagedChannelWorker {
  readonly broadcaster: ChannelBroadcaster;
  readonly completion: Promise<void>;
  stopCalls = 0;

  private readonly output = new PassThrough();
  private readonly completionState = new Deferred<void>();
  private stopGate: Deferred<void> | undefined;
  private stopFailure: unknown;
  private stopPromise: Promise<void> | undefined;

  constructor(readonly channelId: ChannelId) {
    this.completion = this.completionState.promise;
    this.broadcaster = new ChannelBroadcaster(this.output, {
      subscriberBufferLimitBytes: 1_024,
      retentionLimitBytes: 1_024,
      findJoinPoint: (bytes) =>
        bytes.indexOf("INIT") === -1 ? undefined : bytes.indexOf("INIT"),
    });
    this.output.write("INIT-ready");
    void this.completion.catch(() => undefined);
  }

  /** Delegates viewer creation to the worker's single shared broadcaster. */
  trySubscribe() {
    return this.broadcaster.trySubscribe();
  }

  /** Settles this fake worker once while preserving stop idempotence. */
  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.stopCalls += 1;
    this.stopPromise = this.finishStop();
    return this.stopPromise;
  }

  /** Holds cleanup open so tests can prove replacement cannot overlap it. */
  delayStop(): void {
    this.stopGate = new Deferred<void>();
  }

  /** Releases cleanup after a race assertion has observed the stopping state. */
  releaseStop(): void {
    this.stopGate?.resolve(undefined);
  }

  /** Arranges a bounded cleanup failure after any configured stop gate opens. */
  failStop(error: unknown): void {
    this.stopFailure = error;
  }

  /** Exposes spontaneous worker failure independently from manager stop. */
  fail(error: unknown): void {
    this.completionState.reject(error);
    this.output.destroy(error instanceof Error ? error : new Error("failed"));
  }

  /** Evicts retained initialization so a ready worker can no longer accept viewers. */
  loseJoinability(): void {
    this.output.write("x".repeat(1_024));
  }

  /** Retains a fresh initialization point so later viewers can join again. */
  restoreJoinability(): void {
    this.output.write("INIT");
  }

  /** Settles owned stream state after any arranged cleanup delay. */
  private async finishStop(): Promise<void> {
    await this.stopGate?.promise;
    if (this.stopFailure !== undefined) throw this.stopFailure;
    this.output.end();
    this.completionState.resolve(undefined);
  }
}

class ControlledWorkerFactory {
  readonly calls: Array<{
    channelId: ChannelId;
    signal: AbortSignal;
    result: Deferred<ManagedChannelWorker>;
  }> = [];

  /** Creates a controllable readiness promise for one prospective worker. */
  create(
    channelId: ChannelId,
    signal: AbortSignal,
  ): Promise<ManagedChannelWorker> {
    const result = new Deferred<ManagedChannelWorker>();
    this.calls.push({ channelId, signal, result });
    return result.promise;
  }
}

const settlePromises = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

const expectSignalError = async (
  promise: Promise<unknown>,
  code: SignalErrorCode,
): Promise<SignalError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SignalError);
    expect(error).toMatchObject({ code });
    return error as SignalError;
  }
  throw new Error(`Expected ${code}`);
};

describe("ChannelStreamManager", () => {
  it("deduplicates concurrent creation and publishes only a ready worker", async () => {
    const authorization = new MutableAuthorization();
    const workerFactory = new ControlledWorkerFactory();
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({ authorization, workerFactory });
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
    const manager = new ChannelStreamManager({ authorization, workerFactory });
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
    const manager = new ChannelStreamManager({ authorization, workerFactory });
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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

  it("treats abort after subscription creation as caller-owned closure", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = new ChannelStreamManager({
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

  it("makes shutdown terminal and cleans a late-ready pending worker", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({
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

  it("rejects mismatched authorization without creating a worker", async () => {
    const workerFactory = new ControlledWorkerFactory();
    const manager = new ChannelStreamManager({
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
    const manager = new ChannelStreamManager({ authorization, workerFactory });
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
