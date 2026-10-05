import { describe, expect, it } from "vitest";
import type { ProcessSpawner } from "@krazitv/process";

import { FakeClock } from "../../testing/fake-clock.js";
import { FakeProcess, FakeProcessSpawner } from "../../testing/fake-process.js";
import { FfmpegProcess } from "./ffmpeg-process.js";
import { expectSignalError } from "../../testing/expect-signal-error.js";
import { RecordingLogger } from "../../testing/recording-logger.js";
import { flushMicrotasks } from "../../testing/settle-promises.js";

const createHarness = (
  options: {
    ffmpegPath?: string;
    terminationGraceMs?: number;
    redactions?: readonly string[];
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
    redactions: options.redactions,
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

  it("reports at most 64 KiB of retained stderr", async () => {
    const { child, managed } = createHarness();

    child.writeStderr(Buffer.alloc(10, "a"));
    child.writeStderr(Buffer.alloc(64 * 1024, "b"));
    child.exit({ code: 1, signal: null });

    const error = await expectSignalError(
      managed.completion,
      "packaging_failed",
    );
    expect(error.details).toMatchObject({ stderrTailBytes: 64 * 1024 });
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
      stderrSummary: "decoder failed",
    });
    expect(logger.errors[0]?.context).toEqual(error.details);
  });

  it("logs the last stderr line with redacted values removed", async () => {
    const mediaPath = "C:/private/media/movie.mkv";
    const { child, managed, logger } = createHarness({
      redactions: [mediaPath],
    });
    child.writeStderr(`Input #0, from '${mediaPath}':
`);
    child.writeStderr(`${mediaPath}: Invalid data found
`);

    child.exit({ code: 1, signal: null });

    const error = await expectSignalError(
      managed.completion,
      "packaging_failed",
    );
    expect(error.details).toMatchObject({
      stderrSummary: "[redacted]: Invalid data found",
    });
    expect(JSON.stringify(error.details)).not.toContain(mediaPath);
    expect(JSON.stringify(logger.errors)).not.toContain(mediaPath);
  });

  it("omits the summary when stderr is empty", async () => {
    const { child, managed } = createHarness();

    child.exit({ code: 1, signal: null });

    const error = await expectSignalError(
      managed.completion,
      "packaging_failed",
    );
    expect(error.details).not.toHaveProperty("stderrSummary");
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
    await flushMicrotasks(2);

    expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL"]);
    child.exit({ code: null, signal: "SIGKILL" });

    await expect(stopped).resolves.toBeUndefined();
    expect(timers.pendingTimerCount).toBe(0);
  });

  it("uses a five-second termination grace period by default", async () => {
    const { child, managed, timers } = createHarness();
    const stopped = managed.stop();

    timers.advanceBy(4_999);
    await flushMicrotasks(2);
    expect(child.terminationSignals).toEqual(["SIGTERM"]);

    timers.advanceBy(1);
    await flushMicrotasks(2);
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
    await flushMicrotasks(2);
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
    await flushMicrotasks(2);
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
