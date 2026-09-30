import { buildFfmpegArguments } from "./ffmpeg-arguments.js";
import { FfmpegProcess } from "../process/ffmpeg-process.js";
import { FfmpegSignalSession } from "./ffmpeg-signal-session.js";
import {
  MpegTsReadinessInspector,
  type OutputReadinessInspector,
} from "../mpeg-ts/mpeg-ts-readiness-inspector.js";
import type { ProcessSpawner } from "../../process/process-spawner.js";
import type { TimerScheduler } from "../../runtime/clock.js";
import type { SignalLogger } from "../../runtime/signal-logger.js";
import type {
  SignalPackager,
  SignalPlayoutItem,
  SignalSession,
} from "../../signal-packager/contracts.js";

export type FfmpegSignalPackagerDependencies = {
  spawner: ProcessSpawner;
  timers: TimerScheduler;
  logger: SignalLogger;
  ffmpegPath?: string;
  terminationGraceMs?: number;
  createReadinessInspector?: () => OutputReadinessInspector;
};

/** Creates one retained FFmpeg session per active channel worker. */
export class FfmpegSignalPackager implements SignalPackager {
  /** Keeps process and inspection dependencies explicit for deterministic tests. */
  constructor(
    private readonly dependencies: FfmpegSignalPackagerDependencies,
  ) {}

  /** Validates and starts one item synchronously so output can be drained at once. */
  start(initialItem: SignalPlayoutItem): SignalSession {
    const args = buildFfmpegArguments(initialItem);
    const process = FfmpegProcess.start({
      args,
      spawner: this.dependencies.spawner,
      timers: this.dependencies.timers,
      logger: this.dependencies.logger,
      ffmpegPath: this.dependencies.ffmpegPath,
      terminationGraceMs: this.dependencies.terminationGraceMs,
      diagnosticContext: {
        channelId: initialItem.channelId,
        scheduleEntryId: initialItem.scheduleEntryId,
        mediaItemId: initialItem.mediaItemId,
      },
      // SIG-010 owns item boundaries; until then any exit before stop fails.
      isSuccessfulExitExpected: () => false,
    });

    return new FfmpegSignalSession(
      process,
      this.dependencies.createReadinessInspector?.() ??
        new MpegTsReadinessInspector(),
    );
  }
}
