import type { Readable } from "node:stream";

import {
  OutputTail,
  terminateProcess,
  type ProcessExit,
  type ProcessSpawner,
  type SpawnedProcess,
} from "@krazitv/process";

import { assertNonNegativeSafeInteger } from "../../options/safe-integer-option.js";
import { SignalError } from "../../errors.js";
import type { TimerScheduler } from "../../runtime/clock.js";
import { RetryableAttempt } from "../../runtime/retryable-attempt.js";
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
  private readonly stderr = new OutputTail(STDERR_TAIL_LIMIT_BYTES);
  private stopRequested = false;
  private readonly stopAttempt = new RetryableAttempt();

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
      this.stderr.append(chunk);
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
      throw logged(
        options.logger,
        new SignalError(
          "packaging_start_failed",
          "FFmpeg could not be started",
          context,
          { cause },
        ),
      );
    }
  }

  /** Returns a defensive copy for deliberate redaction or classified logging. */
  get stderrTail(): Buffer {
    return this.stderr.bytes();
  }

  /** Shares active termination, retains success, and releases failure for retry. */
  stop(): Promise<void> {
    return this.stopAttempt.run(() => {
      this.stopRequested = true;
      return this.stopAndVerify();
    });
  }

  /** Converts unexpected child closure into the package's provider-neutral errors. */
  private async observeCompletion(): Promise<void> {
    let exit: ProcessExit;
    try {
      exit = await this.child.exited;
    } catch (cause) {
      throw logged(
        this.logger,
        new SignalError(
          "packaging_start_failed",
          "FFmpeg failed before process closure",
          this.failureDetails(),
          { cause },
        ),
      );
    }

    if (this.stopRequested) return;
    if (exit.code === 0 && exit.signal === null) {
      if (this.isSuccessfulExitExpected()) return;

      throw logged(
        this.logger,
        new SignalError(
          "packaging_failed",
          "FFmpeg exited before completion was expected",
          this.failureDetails(exit, { reason: "premature_exit" }),
        ),
      );
    }

    throw logged(
      this.logger,
      new SignalError(
        "packaging_failed",
        "FFmpeg exited unexpectedly",
        this.failureDetails(exit),
      ),
    );
  }

  /** Escalates once, then rejects unless process closure can be observed. */
  private async stopAndVerify(): Promise<void> {
    const termination = await terminateProcess(this.child, {
      graceMs: this.terminationGraceMs,
      timers: this.timers,
    });
    if (termination.closed) return;

    throw logged(
      this.logger,
      new SignalError(
        "runtime_cleanup_failed",
        "FFmpeg did not close after forced termination",
        this.failureDetails(),
        termination.cause === undefined
          ? undefined
          : { cause: termination.cause },
      ),
    );
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
      stderrTailBytes: this.stderr.byteLength,
    };
  }
}

/** Logs a failure once at the boundary that classified it, then hands it back to throw. */
function logged(logger: SignalLogger, error: SignalError): SignalError {
  logger.error(error.message, error.details);
  return error;
}
