import { PassThrough, type Readable } from "node:stream";

import type {
  BroadcastSubscriptionCloseReason,
  ChannelSubscription,
} from "./contracts.js";

/** Owns one viewer's bounded queue without influencing the shared source. */
export class ChannelBroadcastSubscription implements ChannelSubscription {
  readonly stream: Readable;
  readonly closed: Promise<BroadcastSubscriptionCloseReason>;

  private readonly queue: PassThrough;
  private readonly resolveClosed: (
    reason: BroadcastSubscriptionCloseReason,
  ) => void;
  private closeReason?: BroadcastSubscriptionCloseReason;

  /** Creates an isolated queue so this viewer cannot block its peers. */
  constructor(
    private readonly bufferLimitBytes: number,
    private readonly onClose: (
      subscription: ChannelBroadcastSubscription,
    ) => void,
  ) {
    this.queue = new PassThrough({
      readableHighWaterMark: bufferLimitBytes,
      writableHighWaterMark: bufferLimitBytes,
    });
    this.stream = this.queue;
    const closed = Promise.withResolvers<BroadcastSubscriptionCloseReason>();
    this.closed = closed.promise;
    this.resolveClosed = closed.resolve;
    this.queue.once("close", () => this.finish("closed", false));
  }

  /** Protects the shared broadcast from this viewer's backpressure. */
  enqueue(chunk: Buffer): void {
    if (this.closeReason !== undefined) return;

    const queuedBytes = this.queue.readableLength + this.queue.writableLength;
    if (queuedBytes + chunk.byteLength > this.bufferLimitBytes) {
      this.finish("buffer_limit_exceeded", false);
      return;
    }

    // This queue owns the limit; its backpressure must never reach the channel.
    this.queue.write(chunk);
  }

  /** Prevents repeated caller cleanup from changing subscriber accounting. */
  close(): void {
    this.finish("closed", false);
  }

  /** Lets the viewer drain valid bytes after a normal source ending. */
  sourceEnded(): void {
    this.finish("source_ended", true);
  }

  /** Prevents a viewer from consuming output from a failed source. */
  sourceFailed(): void {
    this.finish("source_failed", false);
  }

  /** Guarantees that competing close paths affect accounting only once. */
  private finish(
    reason: BroadcastSubscriptionCloseReason,
    preserveBufferedBytes: boolean,
  ): void {
    if (this.closeReason !== undefined) return;
    this.closeReason = reason;
    this.resolveClosed(reason);

    if (preserveBufferedBytes) this.queue.end();
    else this.queue.destroy();

    this.onClose(this);
  }
}
