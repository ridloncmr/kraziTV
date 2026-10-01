import type { Readable } from "node:stream";

import type {
  ProcessExit,
  ProcessSpawner,
  SpawnedProcess,
} from "@krazitv/process";

import { assertNonNegativeSafeInteger } from "../../options/safe-integer-option.js";
import { SignalError } from "../../errors.js";
import type { TimerScheduler } from "../../runtime/clock.js";
import type { LogContext, SignalLogger } from "../../runtime/signal-logger.js";

const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const STDERR_TAIL_LIMIT_BYTES = 64 * 1024;

type FfmpegProcessOptions = {
  args: readonly string[];
  spawner: ProcessSpawner;
  timers: TimerScheduler;
  logger: SignalLogger;
  ffmpegPath?: string;
  terminationGraceMs?: number;
  diagnosticContext?: LogContext;
  isSuccessfulExitExpected: () => boolean;
};

/** Owns one FFmpeg child until normal closure or verified termination. */
export class FfmpegProcess {
  readonly output: Readable;
  readonly completion: Promise<void>;
  private readonly stderrChunks: Buffer[] = [];
  private stderrByteCount = 0;
  private stopRequested = false;
  private stopPromise: Promise<void> | undefined;

  /** Attaches diagnostics before any child output can be left undrained. */
  private constructor(
    private readonly child: SpawnedProcess,
    private readonly timers: TimerScheduler,
    private readonly logger: SignalLogger,
    private readonly terminationGraceMs: number,
    private readonly diagnosticContext: LogContext,
    private readonly isSuccessfulExitExpected: () => boolean,
  ) {
    this.output = child.stdout;
    child.stderr.on("data", (chunk: Buffer | Uint8Array | string) => {
      this.retainStderr(toBuffer(chunk));
    });
    this.completion = this.observeCompletion();
  }

  /** Starts FFmpeg directly and normalizes failures thrown before a handle exists. */
  static start(options: FfmpegProcessOptions): FfmpegProcess {
    const terminationGraceMs =
      options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
    assertNonNegativeSafeInteger(terminationGraceMs, "terminationGraceMs");

    const command = options.ffmpegPath || "ffmpeg";
    const context = options.diagnosticContext ?? {};

    try {
      const child = options.spawner.spawn({ command, args: options.args });
      return new FfmpegProcess(
        child,
        options.timers,
        options.logger,
        terminationGraceMs,
        context,
        options.isSuccessfulExitExpected,
      );
    } catch (cause) {
      const error = new SignalError(
        "packaging_start_failed",
        "FFmpeg could not be started",
        context,
        { cause },
      );
      options.logger.error(error.message, error.details);
      throw error;
    }
  }

  /** Returns a defensive copy for deliberate redaction or classified logging. */
  get stderrTail(): Buffer {
    return Buffer.concat(this.stderrChunks, this.stderrByteCount);
  }

  /** Shares active termination, retains success, and releases failure for retry. */
  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;

    this.stopRequested = true;
    const attempt = this.stopAndVerify();
    this.stopPromise = attempt;
    void attempt.catch(() => {
      if (this.stopPromise === attempt) this.stopPromise = undefined;
    });
    return attempt;
  }

  /** Converts unexpected child closure into the package's provider-neutral errors. */
  private async observeCompletion(): Promise<void> {
    let exit: ProcessExit;
    try {
      exit = await this.child.exited;
    } catch (cause) {
      const error = new SignalError(
        "packaging_start_failed",
        "FFmpeg failed before process closure",
        this.failureDetails(),
        { cause },
      );
      this.logger.error(error.message, error.details);
      throw error;
    }

    if (this.stopRequested) return;
    if (exit.code === 0 && exit.signal === null) {
      if (this.isSuccessfulExitExpected()) return;

      const error = new SignalError(
        "packaging_failed",
        "FFmpeg exited before completion was expected",
        this.failureDetails(exit, { reason: "premature_exit" }),
      );
      this.logger.error(error.message, error.details);
      throw error;
    }

    const error = new SignalError(
      "packaging_failed",
      "FFmpeg exited unexpectedly",
      this.failureDetails(exit),
    );
    this.logger.error(error.message, error.details);
    throw error;
  }

  /** Escalates once, then rejects unless process closure can be observed. */
  private async stopAndVerify(): Promise<void> {
    let terminationCause: unknown;
    try {
      this.child.terminate("SIGTERM");
    } catch (cause) {
      terminationCause = cause;
    }

    if (await this.closesWithinGrace()) return;

    try {
      this.child.terminate("SIGKILL");
    } catch (cause) {
      terminationCause = cause;
    }

    if (await this.closesWithinGrace()) return;

    const error = new SignalError(
      "runtime_cleanup_failed",
      "FFmpeg did not close after forced termination",
      this.failureDetails(),
      terminationCause === undefined ? undefined : { cause: terminationCause },
    );
    this.logger.error(error.message, error.details);
    throw error;
  }

  /** Races observed process closure against one deterministic grace deadline. */
  private closesWithinGrace(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (closed: boolean): void => {
        if (settled) return;
        settled = true;
        deadline.cancel();
        resolve(closed);
      };
      const deadline = this.timers.setTimeout(
        () => finish(false),
        this.terminationGraceMs,
      );

      void this.child.exited.then(
        () => finish(true),
        () => finish(true),
      );
    });
  }

  /** Retains only the newest stderr bytes so noisy children cannot grow memory. */
  private retainStderr(chunk: Buffer): void {
    if (chunk.byteLength === 0) return;

    if (chunk.byteLength >= STDERR_TAIL_LIMIT_BYTES) {
      this.stderrChunks.length = 0;
      this.stderrChunks.push(
        Buffer.from(chunk.subarray(chunk.byteLength - STDERR_TAIL_LIMIT_BYTES)),
      );
      this.stderrByteCount = STDERR_TAIL_LIMIT_BYTES;
      return;
    }

    this.stderrChunks.push(Buffer.from(chunk));
    this.stderrByteCount += chunk.byteLength;
    while (this.stderrByteCount > STDERR_TAIL_LIMIT_BYTES) {
      const first = this.stderrChunks[0];
      if (first === undefined) break;

      const overflow = this.stderrByteCount - STDERR_TAIL_LIMIT_BYTES;
      if (overflow >= first.byteLength) {
        this.stderrChunks.shift();
        this.stderrByteCount -= first.byteLength;
      } else {
        this.stderrChunks[0] = Buffer.from(first.subarray(overflow));
        this.stderrByteCount -= overflow;
      }
    }
  }

  /** Builds bounded context without exposing the executable argument list. */
  private failureDetails(
    exit?: ProcessExit,
    additionalContext: LogContext = {},
  ): LogContext {
    return {
      ...this.diagnosticContext,
      ...(exit === undefined
        ? {}
        : { exitCode: exit.code, signal: exit.signal }),
      ...additionalContext,
      stderrTailBytes: this.stderrByteCount,
    };
  }
}

/** Normalizes supported stream chunks before retaining their bytes. */
const toBuffer = (chunk: Buffer | Uint8Array | string): Buffer => {
  if (Buffer.isBuffer(chunk)) return chunk;
  return Buffer.from(chunk);
};
