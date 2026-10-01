import { describe, expect, it } from "vitest";
import type { ProcessSpawner } from "@krazitv/process";

import { SignalError } from "../../errors.js";
import type { SignalLogger } from "../../runtime/signal-logger.js";
import { FakeClock } from "../../testing/fake-clock.js";
import { FakeProcess, FakeProcessSpawner } from "../../testing/fake-process.js";
import { FfmpegProcess } from "./ffmpeg-process.js";

class RecordingLogger implements SignalLogger {
  readonly errors: Array<{
    message: string;
    context?: Readonly<Record<string, unknown>>;
  }> = [];

  /** Ignores debug output that is irrelevant to lifecycle assertions. */
  debug(): void {}

  /** Ignores informational output that is irrelevant to lifecycle assertions. */
  info(): void {}

  /** Ignores warnings that are irrelevant to lifecycle assertions. */
  warn(): void {}

  /** Retains normalized failure diagnostics for assertions. */
  error(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.errors.push({ message, context });
  }
}

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const expectSignalError = async (
  promise: Promise<unknown>,
  code: SignalError["code"],
): Promise<SignalError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SignalError);
    expect(error).toMatchObject({ code });
    return error as SignalError;
  }

  throw new Error(`Expected ${code}`);
};

const createHarness = (
  options: {
    ffmpegPath?: string;
    terminationGraceMs?: number;
    isSuccessfulExitExpected?: () => boolean;
  } = {},
) => {
  const child = new FakeProcess();
  const spawner = new FakeProcessSpawner();
  const timers = new FakeClock();
  const logger = new RecordingLogger();
  spawner.enqueue(child);

  const managed = FfmpegProcess.start({
    args: ["-version"],
    spawner,
    timers,
    logger,
    ffmpegPath: options.ffmpegPath,
    terminationGraceMs: options.terminationGraceMs,
    diagnosticContext: { channelId: "channel-1" },
    isSuccessfulExitExpected: options.isSuccessfulExitExpected ?? (() => true),
  });

  return { child, spawner, timers, logger, managed };
};

describe("FfmpegProcess", () => {
  it("spawns FFmpeg directly and exposes stdout immediately", () => {
    const { child, managed, spawner } = createHarness();

    expect(managed.output).toBe(child.stdout);
    expect(spawner.spawnCalls).toEqual([
      {
        command: "ffmpeg",
        args: ["-version"],
      },
    ]);
  });

  it("uses the configured executable without adding app config to child env", () => {
    const { spawner } = createHarness({
      ffmpegPath: "C:/tools/ffmpeg.exe",
    });

    expect(spawner.spawnCalls[0]?.command).toBe("C:/tools/ffmpeg.exe");
    expect(spawner.spawnCalls[0]).not.toHaveProperty("env");
  });

  it("resolves completion for a normal zero-code exit", async () => {
    const { child, managed } = createHarness();

    child.exit({ code: 0, signal: null });

    await expect(managed.completion).resolves.toBeUndefined();
  });

  it("normalizes a synchronous spawn failure", () => {
    const cause = new Error("spawn failed");
    const spawner: ProcessSpawner = {
      spawn: () => {
        throw cause;
      },
    };

    expect(() =>
      FfmpegProcess.start({
        args: [],
        spawner,
        timers: new FakeClock(),
        logger: new RecordingLogger(),
        isSuccessfulExitExpected: () => true,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "packaging_start_failed",
        cause,
      }),
    );
  });

  it("normalizes an asynchronous spawn failure", async () => {
    const { child, managed, logger } = createHarness();
    const cause = new Error("ENOENT");

    child.fail(cause);

    const error = await expectSignalError(
      managed.completion,
      "packaging_start_failed",
    );
    expect(error.cause).toBe(cause);
    expect(logger.errors).toHaveLength(1);
  });

  it("retains only the final 64 KiB of stderr", async () => {
    const { child, managed } = createHarness();
    const discarded = Buffer.alloc(10, "a");
    const retained = Buffer.alloc(64 * 1024, "b");

    child.writeStderr(discarded);
    child.writeStderr(retained);
    child.exit({ code: 1, signal: null });
    await expectSignalError(managed.completion, "packaging_failed");

    expect(managed.stderrTail.byteLength).toBe(64 * 1024);
    expect(managed.stderrTail.equals(retained)).toBe(true);
  });

  it("normalizes a non-zero exit with bounded diagnostics", async () => {
    const { child, managed, logger } = createHarness();
    child.writeStderr("decoder failed");

    child.exit({ code: 7, signal: null });

    const error = await expectSignalError(
      managed.completion,
      "packaging_failed",
    );
    expect(error.details).toEqual({
      channelId: "channel-1",
      exitCode: 7,
      signal: null,
      stderrTailBytes: Buffer.byteLength("decoder failed"),
    });
    expect(logger.errors[0]?.context).toEqual(error.details);
  });

  it("normalizes a clean exit that its owner identifies as premature", async () => {
    const { child, managed } = createHarness({
      isSuccessfulExitExpected: () => false,
    });

    child.exit({ code: 0, signal: null });

    const error = await expectSignalError(
      managed.completion,
      "packaging_failed",
    );
    expect(error.message).toBe("FFmpeg exited before completion was expected");
    expect(error.details).toMatchObject({
      channelId: "channel-1",
      exitCode: 0,
      signal: null,
      reason: "premature_exit",
    });
  });

  it("retains stderr without placing sensitive contents in errors or logs", async () => {
    const { child, managed, logger } = createHarness();
    const sensitiveStderr = "failed to open C:/private/media/movie.mkv";
    child.writeStderr(sensitiveStderr);

    child.exit({ code: 1, signal: null });

    const error = await expectSignalError(
      managed.completion,
      "packaging_failed",
    );
    expect(managed.stderrTail.toString()).toBe(sensitiveStderr);
    expect(JSON.stringify(error.details)).not.toContain(sensitiveStderr);
    expect(JSON.stringify(logger.errors)).not.toContain(sensitiveStderr);
    expect(error.details).toMatchObject({
      stderrTailBytes: Buffer.byteLength(sensitiveStderr),
    });
  });

  it("normalizes an unexpected signal exit", async () => {
    const { child, managed } = createHarness();

    child.exit({ code: null, signal: "SIGSEGV" });

    const error = await expectSignalError(
      managed.completion,
      "packaging_failed",
    );
    expect(error.details).toMatchObject({ signal: "SIGSEGV" });
  });

  it("stops gracefully and returns the same promise to repeated callers", async () => {
    const { child, managed, timers } = createHarness();

    const firstStop = managed.stop();
    const secondStop = managed.stop();

    expect(secondStop).toBe(firstStop);
    expect(child.terminationSignals).toEqual(["SIGTERM"]);

    child.exit({ code: null, signal: "SIGTERM" });

    await expect(firstStop).resolves.toBeUndefined();
    await expect(managed.completion).resolves.toBeUndefined();
    expect(timers.pendingTimerCount).toBe(0);
  });

  it("escalates to SIGKILL after the graceful termination deadline", async () => {
    const { child, managed, timers } = createHarness({
      terminationGraceMs: 20,
    });

    const stopped = managed.stop();
    timers.advanceBy(20);
    await flushPromises();

    expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL"]);
    child.exit({ code: null, signal: "SIGKILL" });

    await expect(stopped).resolves.toBeUndefined();
    expect(timers.pendingTimerCount).toBe(0);
  });

  it("uses a five-second termination grace period by default", async () => {
    const { child, managed, timers } = createHarness();
    const stopped = managed.stop();

    timers.advanceBy(4_999);
    await flushPromises();
    expect(child.terminationSignals).toEqual(["SIGTERM"]);

    timers.advanceBy(1);
    await flushPromises();
    expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL"]);

    child.exit({ code: null, signal: "SIGKILL" });
    await expect(stopped).resolves.toBeUndefined();
  });

  it("rejects stop when forced termination cannot be verified", async () => {
    const { managed, timers, logger } = createHarness({
      terminationGraceMs: 20,
    });

    const stopped = managed.stop();
    timers.advanceBy(20);
    await flushPromises();
    timers.advanceBy(20);

    const error = await expectSignalError(stopped, "runtime_cleanup_failed");
    expect(error.details).toMatchObject({ channelId: "channel-1" });
    expect(logger.errors.at(-1)?.context).toEqual(error.details);
  });

  it("retries termination after a shared stop attempt fails", async () => {
    const { child, managed, timers } = createHarness({
      terminationGraceMs: 20,
    });

    const first = managed.stop();
    const concurrent = managed.stop();
    expect(concurrent).toBe(first);
    timers.advanceBy(20);
    await flushPromises();
    timers.advanceBy(20);
    await expect(first).rejects.toMatchObject({
      code: "runtime_cleanup_failed",
    });

    const retry = managed.stop();
    const concurrentRetry = managed.stop();
    expect(retry).not.toBe(first);
    expect(concurrentRetry).toBe(retry);
    child.exit({ code: null, signal: "SIGTERM" });
    await expect(retry).resolves.toBeUndefined();
    expect(managed.stop()).toBe(retry);
    expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL", "SIGTERM"]);
  });

  it("settles stop when startup fails concurrently", async () => {
    const { child, managed, timers } = createHarness();
    const completion = expectSignalError(
      managed.completion,
      "packaging_start_failed",
    );

    const stopped = managed.stop();
    child.fail(new Error("spawn failed during stop"));

    await expect(stopped).resolves.toBeUndefined();
    await completion;
    expect(timers.pendingTimerCount).toBe(0);
  });
});
