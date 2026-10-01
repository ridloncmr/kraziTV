import type { ChannelId } from "../playout/contracts.js";

/** Orders state changes per channel while letting different channels proceed independently. */
export class ChannelTransitionQueue {
  private readonly tails = new Map<ChannelId, Promise<void>>();

  /** Runs one operation after every earlier operation for the same channel settles. */
  run<T>(channelId: ChannelId, operation: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(channelId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(channelId, tail);
    // Drop the tail once idle so the map only holds channels with queued work.
    void tail.then(() => {
      if (this.tails.get(channelId) === tail) this.tails.delete(channelId);
    });
    return result;
  }

  /** Lists channels with queued or running work, so shutdown can wait behind them. */
  channelIds(): ChannelId[] {
    return [...this.tails.keys()];
  }
}
