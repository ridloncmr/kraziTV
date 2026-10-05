import { ChannelStreamManager } from "./channel-stream-manager/channel-stream-manager.js";
import type { ChannelStreamManagerContract } from "./channel-stream-manager/contracts.js";
import { DefaultChannelWorkerFactory } from "./channel-worker/default-channel-worker-factory.js";
import type { ChannelWorkerOptions } from "./channel-worker/channel-worker.js";
import type { ChannelAuthorization } from "./channel-worker/contracts.js";
import { findMpegTsJoinPoint } from "./ffmpeg/mpeg-ts/mpeg-ts-join-point.js";
import type { SignalLogger } from "./runtime/signal-logger.js";

export type CreateChannelStreamManagerOptions = Omit<
  ChannelWorkerOptions,
  "findJoinPoint"
> & {
  authorization: ChannelAuthorization;
  idleGraceMs: number;
  /** Receives failures of published workers, which no viewer request reports. */
  logger: SignalLogger;
  /**
   * Defaults to the MPEG-TS join point the FFmpeg packager's output needs, so
   * callers never choose the container; tests with marker-byte fakes override it.
   */
  findJoinPoint?: ChannelWorkerOptions["findJoinPoint"];
};

/** Creates the production manager while keeping worker construction internal. */
export function createChannelStreamManager(
  options: CreateChannelStreamManagerOptions,
): ChannelStreamManagerContract {
  return new ChannelStreamManager({
    authorization: options.authorization,
    workerFactory: new DefaultChannelWorkerFactory({
      ...options,
      findJoinPoint: options.findJoinPoint ?? findMpegTsJoinPoint,
    }),
    timers: options.timers,
    idleGraceMs: options.idleGraceMs,
    logger: options.logger,
  });
}
