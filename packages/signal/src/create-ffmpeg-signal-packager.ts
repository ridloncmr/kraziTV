import { FfmpegSignalPackager } from "./ffmpeg/packaging/ffmpeg-signal-packager.js";
import { NodeProcessSpawner } from "./process/node-process-spawner.js";
import type { TimerScheduler } from "./runtime/clock.js";
import type { SignalLogger } from "./runtime/signal-logger.js";
import type { SignalPackager } from "./signal-packager/contracts.js";

export type CreateFfmpegSignalPackagerOptions = {
  logger: SignalLogger;
  timers: TimerScheduler;
  ffmpegPath?: string;
  terminationGraceMs?: number;
};

/** Creates the production FFmpeg packager without exposing process internals. */
export function createFfmpegSignalPackager(
  options: CreateFfmpegSignalPackagerOptions,
): SignalPackager {
  return new FfmpegSignalPackager({
    spawner: new NodeProcessSpawner(),
    timers: options.timers,
    logger: options.logger,
    ffmpegPath: options.ffmpegPath,
    terminationGraceMs: options.terminationGraceMs,
  });
}
