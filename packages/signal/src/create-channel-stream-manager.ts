import { ChannelStreamManager } from "./channel-stream-manager/channel-stream-manager.js";
import type { ChannelStreamManagerContract } from "./channel-stream-manager/contracts.js";
import { DefaultChannelWorkerFactory } from "./channel-worker/default-channel-worker-factory.js";
import type { ChannelWorkerOptions } from "./channel-worker/channel-worker.js";
import type { ChannelAuthorization } from "./channel-worker/contracts.js";

export type CreateChannelStreamManagerOptions = ChannelWorkerOptions & {
  authorization: ChannelAuthorization;
  idleGraceMs: number;
};

/** Creates the production manager while keeping worker construction internal. */
export function createChannelStreamManager(
  options: CreateChannelStreamManagerOptions,
): ChannelStreamManagerContract {
  return new ChannelStreamManager({
    authorization: options.authorization,
    workerFactory: new DefaultChannelWorkerFactory(options),
    timers: options.timers,
    idleGraceMs: options.idleGraceMs,
  });
}
