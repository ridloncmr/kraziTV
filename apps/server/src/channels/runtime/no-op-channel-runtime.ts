import type { ChannelRuntime } from "../contracts.js";

/**
 * The production channel runtime until the server composes a real channel
 * stream manager. No stream workers exist yet, so every stop is already settled.
 */
export const noOpChannelRuntime: ChannelRuntime = {
  /** Resolves at once: there is never a worker to stop. */
  async stopChannel() {},
};
