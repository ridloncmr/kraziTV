import { PassThrough } from "node:stream";

import { ChannelBroadcaster } from "../channel-broadcast/channel-broadcaster.js";
import type { ManagedChannelWorker } from "../channel-worker/contracts.js";
import type { ChannelId } from "../playout/contracts.js";
import { RetryableAttempt } from "../runtime/retryable-attempt.js";
import { Deferred } from "./deferred.js";

/** Stands in for a published worker with a real broadcaster and scriptable stop and failure. */
export class FakeManagedWorker implements ManagedChannelWorker {
  readonly broadcaster: ChannelBroadcaster;
  readonly completion: Promise<void>;
  stopCalls = 0;

  private readonly output = new PassThrough();
  private readonly completionState = new Deferred<void>();
  private stopGate: Deferred<void> | undefined;
  private stopFailure: unknown;
  private nextStopFailure: unknown;
  private readonly stopAttempt = new RetryableAttempt();

  /** Starts already joinable, as a published worker is, with a real broadcaster. */
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
    return this.stopAttempt.run(() => {
      this.stopCalls += 1;
      return this.finishStop();
    });
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

  /** Fails only the next cleanup attempt so manager retry can be exercised. */
  failNextStop(error: unknown): void {
    this.nextStopFailure = error;
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

  /** Pushes shared output so subscriber eviction can be observed by the manager. */
  pushOutput(chunk: string): void {
    this.output.write(chunk);
  }

  /** Settles owned stream state after any arranged cleanup delay. */
  private async finishStop(): Promise<void> {
    await this.stopGate?.promise;
    if (this.nextStopFailure !== undefined) {
      const failure = this.nextStopFailure;
      this.nextStopFailure = undefined;
      throw failure;
    }
    if (this.stopFailure !== undefined) throw this.stopFailure;
    this.output.end();
    this.completionState.resolve(undefined);
  }
}
