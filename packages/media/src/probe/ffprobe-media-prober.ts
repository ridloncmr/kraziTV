import {
  assertPositiveSafeInteger,
  OutputTail,
  STDERR_TAIL_LIMIT_BYTES,
  terminateProcess,
  type ProcessExit,
  type ProcessSpawner,
  type SpawnedProcess,
} from "@krazitv/process";

import type {
  MediaProbeOptions,
  MediaProbeResult,
  MediaProber,
} from "./contracts.js";
import { buildFfprobeArguments } from "./ffprobe-arguments.js";
import { MediaProbeError, sanitizeProbeText } from "./media-probe-error.js";
import { parseFfprobeOutput } from "./parse-ffprobe-output.js";

const STDOUT_LIMIT_BYTES = 1024 * 1024;
const TERMINATION_GRACE_MS = 5_000;

type StopReason = "timed_out" | "cancelled" | "output_limit_exceeded";

export interface FfprobeMediaProberOptions {
  /** Executable to spawn; the server resolves `FFPROBE_PATH` before this point. */
  ffprobePath: string;
  /** Positive whole-millisecond budget for one probe, from spawn to closure request. */
  timeoutMs: number;
  spawner: ProcessSpawner;
}

/**
 * Inspects one media file with ffprobe. Every probe is bounded in time and
 * output, and never settles while its child is still running, so a caller's
 * concurrency slot always reflects a real process.
 */
export class FfprobeMediaProber implements MediaProber {
  private readonly ffprobePath: string;
  private readonly timeoutMs: number;
  private readonly spawner: ProcessSpawner;

  /** Validates limits up front so a bad configuration fails at startup. */
  constructor(options: FfprobeMediaProberOptions) {
    if (options.ffprobePath === "") {
      throw new RangeError("ffprobePath must not be empty");
    }
    assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");

    this.ffprobePath = options.ffprobePath;
    this.timeoutMs = options.timeoutMs;
    this.spawner = options.spawner;
  }

  /**
   * Probes one file. Rejects with a MediaProbeError whose message is safe to
   * store as the catalog item's probe error.
   */
  async probe(
    path: string,
    options: MediaProbeOptions = {},
  ): Promise<MediaProbeResult> {
    const { signal } = options;
    if (signal?.aborted) throw stopError("cancelled", this.timeoutMs);

    let child: SpawnedProcess;
    try {
      child = this.spawner.spawn({
        command: this.ffprobePath,
        args: buildFfprobeArguments(path),
      });
    } catch (cause) {
      throw spawnError(cause);
    }

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    const stderrTail = new OutputTail(STDERR_TAIL_LIMIT_BYTES);
    let stopReason: StopReason | undefined;

    // The first reason wins; later triggers cannot restart or re-signal the stop.
    // Closure is still awaited below, so the termination result is not needed.
    const stop = (reason: StopReason): void => {
      if (stopReason !== undefined) return;
      stopReason = reason;
      void terminateProcess(child, { graceMs: TERMINATION_GRACE_MS });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      // Once stopping, keep draining the pipe but retain nothing.
      if (stopReason !== undefined) return;
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > STDOUT_LIMIT_BYTES) {
        stdoutChunks.length = 0;
        stop("output_limit_exceeded");
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderrTail.append(chunk));

    const onAbort = (): void => stop("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutTimer = setTimeout(() => stop("timed_out"), this.timeoutMs);

    let exit: ProcessExit;
    try {
      exit = await child.exited;
    } catch (cause) {
      throw spawnError(cause);
    } finally {
      clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
    }

    const failure = exitFailure(
      stopReason,
      exit,
      stderrTail.bytes(),
      this.timeoutMs,
    );
    if (failure !== undefined) throw failure;

    return parseFfprobeOutput(Buffer.concat(stdoutChunks).toString("utf8"));
  }
}

/**
 * Returns the first reason a closed probe produced no usable output, or
 * undefined for a clean exit. A stop this adapter requested wins over the
 * exit it caused, so a timeout is never reported as a signal.
 */
function exitFailure(
  stopReason: StopReason | undefined,
  exit: ProcessExit,
  stderrTail: Buffer,
  timeoutMs: number,
): MediaProbeError | undefined {
  if (stopReason !== undefined) return stopError(stopReason, timeoutMs);
  if (exit.signal !== null) {
    return new MediaProbeError(
      "terminated_by_signal",
      withStderrSummary(`ffprobe was terminated by ${exit.signal}`, stderrTail),
    );
  }
  if (exit.code !== 0) {
    return new MediaProbeError(
      "exited_with_error",
      withStderrSummary(`ffprobe exited with code ${exit.code}`, stderrTail),
    );
  }
  return undefined;
}

/** Appends ffprobe's last meaningful diagnostic line; the error bounds its length. */
function withStderrSummary(message: string, stderrTail: Buffer): string {
  const lastLine = stderrTail
    .toString("utf8")
    .split(/\r?\n/)
    .map(sanitizeProbeText)
    .filter((line) => line !== "")
    .at(-1);
  return lastLine === undefined ? message : `${message}: ${lastLine}`;
}

/** Describes why a probe this adapter stopped did not produce metadata. */
function stopError(reason: StopReason, timeoutMs: number): MediaProbeError {
  switch (reason) {
    case "timed_out":
      return new MediaProbeError(
        reason,
        `ffprobe timed out after ${timeoutMs} ms`,
      );
    case "cancelled":
      return new MediaProbeError(reason, "Probe was cancelled");
    case "output_limit_exceeded":
      return new MediaProbeError(reason, "ffprobe output exceeded 1 MiB");
  }
}

/** Normalizes synchronous and asynchronous spawn failures alike. */
function spawnError(cause: unknown): MediaProbeError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new MediaProbeError(
    "spawn_failed",
    `ffprobe could not be started: ${detail}`,
    {
      cause,
    },
  );
}
