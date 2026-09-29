import type { ChannelId } from "../playout/contracts.js";

export interface ChannelWorkerFactory<TWorker> {
  create(channelId: ChannelId, signal: AbortSignal): Promise<TWorker>;
}
