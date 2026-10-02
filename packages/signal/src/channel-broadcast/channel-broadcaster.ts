import type { Readable } from "node:stream";

import { OutputTail } from "@krazitv/process";

import {
  assertPositiveSafeInteger,
  isNonNegativeSafeInteger,
} from "../options/safe-integer-option.js";
import { ChannelBroadcastSubscription } from "./channel-broadcast-subscription.js";

type ChannelBroadcasterOptions = {
  subscriberBufferLimitBytes: number;
  retentionLimitBytes: number;
  /** Isolates format-specific initialization rules from viewer lifecycle. */
  findJoinPoint: (retainedBytes: Buffer) => number | undefined;
};

/**
 * Drains one channel source continuously and fans it out to independently
 * bounded subscriber streams. Subscriber backpressure never reaches source.
 */
export class ChannelBroadcaster {
  private readonly subscribers = new Set<ChannelBroadcastSubscription>();
  /** Bounds the memory reserved for startup and late joins. */
  private readonly retained: OutputTail;
  private sourceFinished = false;

  /** Attaches immediately so startup output cannot block or disappear. */
  constructor(
    source: Readable,
    private readonly options: ChannelBroadcasterOptions,
  ) {
    assertPositiveSafeInteger(
      options.subscriberBufferLimitBytes,
      "subscriberBufferLimitBytes",
    );
    assertPositiveSafeInteger(
      options.retentionLimitBytes,
      "retentionLimitBytes",
    );
    this.retained = new OutputTail(options.retentionLimitBytes);

    source.on("data", (chunk: Buffer | Uint8Array | string) => {
      this.acceptChunk(toBuffer(chunk));
    });
    source.once("end", () => this.finishSource("source_ended"));
    source.once("error", () => this.finishSource("source_failed"));
    source.once("close", () => {
      if (!this.sourceFinished) this.finishSource("source_failed");
    });
  }

  /** Exposes viewer count for worker lifecycle decisions. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Exposes retained usage so configured memory bounds are observable. */
  get retainedByteCount(): number {
    return this.retained.byteLength;
  }

  /** Reports when the retained window can initialize a new viewer. */
  get hasJoinableInitialization(): boolean {
    return this.findJoinableReplay() !== undefined;
  }

  /** Creates a viewer only when replay can begin at a valid initialization point. */
  trySubscribe(): ChannelBroadcastSubscription | undefined {
    if (this.sourceFinished) return undefined;

    const replay = this.findJoinableReplay();
    if (replay === undefined) return undefined;

    const subscription = new ChannelBroadcastSubscription(
      this.options.subscriberBufferLimitBytes,
      (closedSubscription) => {
        this.subscribers.delete(closedSubscription);
      },
    );
    this.subscribers.add(subscription);
    if (replay.byteLength > 0) subscription.enqueue(replay);
    return subscription;
  }

  /** Keeps retention and every healthy viewer aligned to one channel signal. */
  private acceptChunk(chunk: Buffer): void {
    if (this.sourceFinished || chunk.byteLength === 0) return;

    this.retained.append(chunk);
    for (const subscriber of [...this.subscribers]) {
      subscriber.enqueue(chunk);
    }
  }

  /** Keeps stream-format knowledge behind the injected compatibility strategy. */
  private findJoinableReplay(): Buffer | undefined {
    const retained = this.retained.bytes();
    const offset = this.options.findJoinPoint(retained);
    if (offset === undefined) return undefined;
    if (!isNonNegativeSafeInteger(offset) || offset > retained.byteLength) {
      throw new RangeError(
        "findJoinPoint returned an offset outside the retained byte window",
      );
    }

    const replay = retained.subarray(offset);
    if (replay.byteLength > this.options.subscriberBufferLimitBytes) {
      return undefined;
    }

    return replay;
  }

  /** Ends all viewers together when their single shared source terminates. */
  private finishSource(reason: "source_ended" | "source_failed"): void {
    if (this.sourceFinished) return;
    this.sourceFinished = true;

    for (const subscriber of [...this.subscribers]) {
      if (reason === "source_ended") subscriber.sourceEnded();
      else subscriber.sourceFailed();
    }
  }
}

/** Normalizes Node stream chunk shapes at the broadcaster boundary. */
const toBuffer = (chunk: Buffer | Uint8Array | string): Buffer => {
  if (Buffer.isBuffer(chunk)) return chunk;
  return Buffer.from(chunk);
};
