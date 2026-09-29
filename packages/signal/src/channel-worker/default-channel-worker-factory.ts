import type { ChannelId } from "../playout/contracts.js";
import { ChannelWorker, type ChannelWorkerOptions } from "./channel-worker.js";
import type { ChannelWorkerFactory } from "./worker-factory.js";

/** Creates production channel workers behind the manager's narrow factory port. */
export class DefaultChannelWorkerFactory implements ChannelWorkerFactory<ChannelWorker> {
  /** Retains shared runtime dependencies without starting channel resources. */
  constructor(private readonly options: ChannelWorkerOptions) {}

  /** Starts one readiness-gated worker for the requested channel. */
  create(channelId: ChannelId, signal: AbortSignal): Promise<ChannelWorker> {
    return ChannelWorker.start(channelId, signal, this.options);
  }
}
