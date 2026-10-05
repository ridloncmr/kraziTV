import type { Readable } from "node:stream";

import {
  assertNonNegativeSafeInteger,
  OutputTail,
  STDERR_TAIL_LIMIT_BYTES,
  summarizeStderr,
  terminateProcess,
  type ProcessExit,
  type ProcessSpawner,
  type SpawnedProcess,
} from "@krazitv/process";

import { SignalError, type SignalErrorCode } from "../../errors.js";
import type { TimerScheduler } from "../../runtime/clock.js";
import { RetryableAttempt } from "../../runtime/retryable-attempt.js";
import type { LogContext, SignalLogger } from "../../runtime/signal-logger.js";

const DEFAULT_TERMINATION_GRACE_MS = 5_000;

type FfmpegProcessOptions = {
  args: readonly string[];
  spawner: ProcessSpawner;
  timers: TimerScheduler;
  logger: SignalLogger;
  ffmpegPath: string;
  terminationGraceMs?: number;
  diagnosticContext?: LogContext;
  /** Values, such as the media path, replaced before stderr reaches a log. */
  redactions?: readonly string[];
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
    private readonly redactions: readonly string[],
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

    const context = options.diagnosticContext ?? {};

    try {
      const child = options.spawner.spawn({
        command: options.ffmpegPath,
        args: options.args,
      });
      return new FfmpegProcess(
        child,
        options.timers,
        options.logger,
        terminationGraceMs,
        context,
        options.redactions ?? [],
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
      throw this.fail(
        "packaging_start_failed",
        "FFmpeg failed before process closure",
        this.failureDetails(),
        { cause },
      );
    }

    if (this.stopRequested) return;
    if (exit.code === 0 && exit.signal === null) return;

    throw this.fail(
      "packaging_failed",
      "FFmpeg exited unexpectedly",
      this.failureDetails(exit),
    );
  }

  /** Escalates once, then rejects unless process closure can be observed. */
  private async stopAndVerify(): Promise<void> {
    const termination = await terminateProcess(this.child, {
      graceMs: this.terminationGraceMs,
      timers: this.timers,
    });
    if (termination.closed) return;

    throw this.fail(
      "runtime_cleanup_failed",
      "FFmpeg did not close after forced termination",
      this.failureDetails(),
      termination.cause === undefined
        ? undefined
        : { cause: termination.cause },
    );
  }

  /**
   * Builds a failure and logs it once to this process's logger, so every
   * classified failure of a running child is logged exactly where it is
   * classified.
   */
  private fail(
    code: SignalErrorCode,
    message: string,
    details: LogContext,
    options?: ErrorOptions,
  ): SignalError {
    return logged(
      this.logger,
      new SignalError(code, message, details, options),
    );
  }

  /**
   * Builds bounded context without exposing the executable argument list.
   * FFmpeg states why it failed on its last stderr line, so that line is
   * carried with every redacted value replaced.
   */
  private failureDetails(exit?: ProcessExit): LogContext {
    const stderrSummary = summarizeStderr(this.stderr.bytes(), this.redactions);
    return {
      ...this.diagnosticContext,
      ...(exit === undefined
        ? {}
        : { exitCode: exit.code, signal: exit.signal }),
      stderrTailBytes: this.stderr.byteLength,
      ...(stderrSummary === undefined ? {} : { stderrSummary }),
    };
  }
}

/** Logs a failure once at the boundary that classified it, then hands it back to throw. */
function logged(logger: SignalLogger, error: SignalError): SignalError {
  logger.error(error.message, error.details);
  return error;
}
