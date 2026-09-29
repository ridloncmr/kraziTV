import type {
  SignalLogger,
  SignalPackager,
  TimerScheduler,
} from "./contracts.js";
import { FfmpegSignalPackager } from "./internal/ffmpeg-signal-packager.js";
import { NodeProcessSpawner } from "./internal/node-process-spawner.js";

export type CreateFfmpegSignalPackagerOptions = {
  logger: SignalLogger;
  timers: TimerScheduler;
  environment?: Readonly<Record<string, string | undefined>>;
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
    environment: options.environment,
    terminationGraceMs: options.terminationGraceMs,
  });
}
