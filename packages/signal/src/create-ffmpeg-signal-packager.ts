import { NodeProcessSpawner } from "@krazitv/process";

import { FfmpegSignalPackager } from "./ffmpeg/packaging/ffmpeg-signal-packager.js";
import type { Clock, TimerScheduler } from "./runtime/clock.js";
import type { SignalLogger } from "./runtime/signal-logger.js";
import type { SignalPackager } from "./signal-packager/contracts.js";

export type CreateFfmpegSignalPackagerOptions = {
  logger: SignalLogger;
  timers: TimerScheduler;
  /** Times how long a first viewer's tune is held for the join backlog. */
  clock: Clock;
  /** The server's resolved `FFMPEG_PATH`; the one place its default lives. */
  ffmpegPath: string;
  terminationGraceMs?: number;
  itemReadinessTimeoutMs?: number;
  /** The server's resolved `FFMPEG_FONT_FILE`, for filler messages. */
  fillerFontFile?: string | undefined;
};

/** Creates the production FFmpeg packager without exposing process internals. */
export function createFfmpegSignalPackager(
  options: CreateFfmpegSignalPackagerOptions,
): SignalPackager {
  return new FfmpegSignalPackager({
    spawner: new NodeProcessSpawner(),
    timers: options.timers,
    clock: options.clock,
    logger: options.logger,
    ffmpegPath: options.ffmpegPath,
    terminationGraceMs: options.terminationGraceMs,
    itemReadinessTimeoutMs: options.itemReadinessTimeoutMs,
    fillerFontFile: options.fillerFontFile,
  });
}
