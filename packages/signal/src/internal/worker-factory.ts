import type { ChannelId } from "../contracts.js";

export interface ChannelWorkerFactory<TWorker> {
  create(channelId: ChannelId, signal: AbortSignal): Promise<TWorker>;
}
