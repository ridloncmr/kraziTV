import { access, constants } from "node:fs/promises";

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
    isMediaPresent: isReadableFile,
    timers: options.timers,
    clock: options.clock,
    logger: options.logger,
    ffmpegPath: options.ffmpegPath,
    terminationGraceMs: options.terminationGraceMs,
    itemReadinessTimeoutMs: options.itemReadinessTimeoutMs,
    fillerFontFile: options.fillerFontFile,
  });
}

/**
 * Reports a file as missing only when the filesystem says it is absent or
 * unreadable. Any other error, such as a flaky mount, is left for FFmpeg to
 * report. Asynchronous, so a stalled mount blocks a worker thread, never the
 * event loop.
 */
async function isReadableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return !(code === "ENOENT" || code === "ENOTDIR" || code === "EACCES");
  }
}
