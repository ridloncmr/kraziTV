import { NodeProcessSpawner } from "@krazitv/process";

import { FfmpegSignalPackager } from "./ffmpeg/packaging/ffmpeg-signal-packager.js";
import type { TimerScheduler } from "./runtime/clock.js";
import type { SignalLogger } from "./runtime/signal-logger.js";
import type { SignalPackager } from "./signal-packager/contracts.js";

export type CreateFfmpegSignalPackagerOptions = {
  logger: SignalLogger;
  timers: TimerScheduler;
  /** The server's resolved `FFMPEG_PATH`; the one place its default lives. */
  ffmpegPath: string;
  terminationGraceMs?: number;
  itemReadinessTimeoutMs?: number;
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
    itemReadinessTimeoutMs: options.itemReadinessTimeoutMs,
  });
}
