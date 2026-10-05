/**
 * Serializes lifecycle changes per channel inside this server process, so a
 * re-enable's stop-then-commit cannot interleave with a disable or delete of
 * the same channel. Different channels never wait on each other.
 */
export class ChannelLifecycleLock {
  #tails = new Map<string, Promise<void>>();

  /**
   * Waits for earlier holders of this channel's lock and returns its release.
   * Returns a plain function rather than running a callback, because route
   * handlers produce thenable FastifyReply values that a callback would swallow.
   */
  async acquire(channelId: string): Promise<() => void> {
    const previous = this.#tails.get(channelId) ?? Promise.resolve();
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const tail = previous.then(() => held);
    this.#tails.set(channelId, tail);
    await previous;
    return () => {
      release();
      // Forget the channel once nobody is queued behind this holder.
      if (this.#tails.get(channelId) === tail) this.#tails.delete(channelId);
    };
  }
}
