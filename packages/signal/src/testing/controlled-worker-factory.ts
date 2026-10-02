import type {
  ChannelWorkerFactory,
  ManagedChannelWorker,
} from "../channel-worker/contracts.js";
import type { ChannelId } from "../playout/contracts.js";
import { Deferred } from "./deferred.js";

/** Holds each worker creation open so tests decide when, and how, startup settles. */
export class ControlledWorkerFactory implements ChannelWorkerFactory<ManagedChannelWorker> {
  readonly calls: Array<{
    channelId: ChannelId;
    signal: AbortSignal;
    result: Deferred<ManagedChannelWorker>;
  }> = [];

  /** Creates a controllable readiness promise for one prospective worker. */
  create(
    channelId: ChannelId,
    signal: AbortSignal,
  ): Promise<ManagedChannelWorker> {
    const result = new Deferred<ManagedChannelWorker>();
    this.calls.push({ channelId, signal, result });
    return result.promise;
  }
}
