// Test-only ChannelStreams whose subscriptions each test settles by hand.
import { PassThrough } from "node:stream";

import { SignalError, type ChannelSubscribeOptions } from "@krazitv/signal";

import type { ChannelStreams } from "../channels/contracts.js";

/** One subscribe call the test has not settled yet. */
export interface PendingSubscribe {
  channelId: string;
  signal: AbortSignal | undefined;
  /** Hands the route a live viewer stream the test writes to. */
  open(): ControlledSubscription;
  /** Fails the subscription before any response is committed. */
  fail(error: unknown): void;
}

/** A viewer stream the test feeds, with a count of the route's closes. */
export interface ControlledSubscription {
  readonly stream: PassThrough;
  readonly closeCount: number;
}

/**
 * Records every subscribe and leaves it pending until the test opens or fails
 * it, so route tests control readiness without a worker or FFmpeg.
 */
export class ControlledChannelStreams implements ChannelStreams {
  readonly #pending: PendingSubscribe[] = [];
  readonly #waiters: Array<(call: PendingSubscribe) => void> = [];
  readonly #opened: PassThrough[] = [];
  // Rejectors for tunes neither opened nor failed, so shutdown can end them.
  readonly #unsettled = new Set<(error: unknown) => void>();

  /** Queues the call for the test and settles only when the test decides. */
  subscribe(channelId: string, options: ChannelSubscribeOptions = {}) {
    return new Promise<{ stream: PassThrough; close(): void }>(
      (resolve, reject) => {
        this.#unsettled.add(reject);
        const call: PendingSubscribe = {
          channelId,
          signal: options.signal,
          open: () => {
            const stream = new PassThrough();
            const subscription = {
              stream,
              closeCount: 0,
              close() {
                subscription.closeCount += 1;
                stream.destroy();
              },
            };
            this.#opened.push(stream);
            this.#unsettled.delete(reject);
            resolve(subscription);
            return subscription;
          },
          fail: (error) => {
            this.#unsettled.delete(reject);
            reject(error);
          },
        };
        const waiter = this.#waiters.shift();
        if (waiter === undefined) this.#pending.push(call);
        else waiter(call);
      },
    );
  }

  /**
   * Fails unsettled tunes and ends opened streams, as the real manager does,
   * so a server closing mid-test answers 503 instead of hanging.
   */
  async shutdown(): Promise<void> {
    for (const reject of this.#unsettled) {
      reject(new SignalError("manager_shutdown", "Manager shut down"));
    }
    this.#unsettled.clear();
    for (const stream of this.#opened.splice(0)) stream.destroy();
  }

  /** Resolves with the oldest unclaimed subscribe, waiting for one if needed. */
  nextSubscribe(): Promise<PendingSubscribe> {
    const call = this.#pending.shift();
    if (call !== undefined) return Promise.resolve(call);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }
}
