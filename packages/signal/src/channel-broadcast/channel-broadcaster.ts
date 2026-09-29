import type { Readable } from "node:stream";

import { ChannelBroadcastSubscription } from "./channel-broadcast-subscription.js";

type ChannelBroadcasterOptions = {
  subscriberBufferLimitBytes: number;
  retentionLimitBytes: number;
  /** Isolates format-specific initialization rules from viewer lifecycle. */
  findJoinPoint(retainedBytes: Buffer): number | undefined;
};

/**
 * Drains one channel source continuously and fans it out to independently
 * bounded subscriber streams. Subscriber backpressure never reaches source.
 */
export class ChannelBroadcaster {
  private readonly subscribers = new Set<ChannelBroadcastSubscription>();
  private readonly retainedChunks: Buffer[] = [];
  private retainedBytes = 0;
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
    return this.retainedBytes;
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

    this.retain(chunk);
    for (const subscriber of [...this.subscribers]) {
      subscriber.enqueue(chunk);
    }
  }

  /** Bounds the memory reserved for startup and late joins. */
  private retain(chunk: Buffer): void {
    const limit = this.options.retentionLimitBytes;

    if (chunk.byteLength >= limit) {
      this.retainedChunks.length = 0;
      this.retainedChunks.push(
        Buffer.from(chunk.subarray(chunk.byteLength - limit)),
      );
      this.retainedBytes = limit;
      return;
    }

    this.retainedChunks.push(chunk);
    this.retainedBytes += chunk.byteLength;

    while (this.retainedBytes > limit) {
      const first = this.retainedChunks[0];
      if (first === undefined) break;

      const overflow = this.retainedBytes - limit;
      if (overflow >= first.byteLength) {
        this.retainedChunks.shift();
        this.retainedBytes -= first.byteLength;
      } else {
        this.retainedChunks[0] = Buffer.from(first.subarray(overflow));
        this.retainedBytes -= overflow;
      }
    }
  }

  /** Keeps stream-format knowledge behind the injected compatibility strategy. */
  private findJoinableReplay(): Buffer | undefined {
    const retained = Buffer.concat(this.retainedChunks, this.retainedBytes);
    const offset = this.options.findJoinPoint(retained);
    if (offset === undefined) return undefined;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > retained.byteLength
    ) {
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

/** Rejects unsafe limits before source listeners create runtime side effects. */
const assertPositiveSafeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
};

/** Normalizes Node stream chunk shapes at the broadcaster boundary. */
const toBuffer = (chunk: Buffer | Uint8Array | string): Buffer => {
  if (Buffer.isBuffer(chunk)) return chunk;
  return Buffer.from(chunk);
};
