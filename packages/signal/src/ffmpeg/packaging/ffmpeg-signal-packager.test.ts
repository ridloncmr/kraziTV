import { describe, expect, it } from "vitest";

import { SignalError } from "../../errors.js";
import type { SignalLogger } from "../../runtime/signal-logger.js";
import type { SignalPlayoutItem } from "../../signal-packager/contracts.js";
import { FakeClock } from "../../testing/fake-clock.js";
import { FakeProcess, FakeProcessSpawner } from "../../testing/fake-process.js";
import { FfmpegSignalPackager } from "./ffmpeg-signal-packager.js";
import type { OutputReadinessInspector } from "../mpeg-ts/mpeg-ts-readiness-inspector.js";

class RecordingLogger implements SignalLogger {
  readonly errors: Array<{
    message: string;
    context?: Readonly<Record<string, unknown>>;
  }> = [];

  /** Ignores debug output outside these lifecycle assertions. */
  debug(): void {}

  /** Ignores informational output outside these lifecycle assertions. */
  info(): void {}

  /** Ignores warning output outside these lifecycle assertions. */
  warn(): void {}

  /** Retains safe normalized failures for assertions. */
  error(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.errors.push({ message, context });
  }
}

class MarkerInspector implements OutputReadinessInspector {
  /** Treats an explicit test marker as usable media output. */
  observe(chunk: Uint8Array): boolean {
    return Buffer.from(chunk).includes("usable-output");
  }
}

const initialItem = (
  overrides: Partial<SignalPlayoutItem> = {},
): SignalPlayoutItem => ({
  channelId: "channel-1",
  scheduleEntryId: "entry-1",
  mediaItemId: "media-1",
  mediaPath: "C:/private/media/movie.mkv",
  mediaOffsetMs: 250,
  playDurationMs: 30_000,
  ...overrides,
});

const createHarness = () => {
  const child = new FakeProcess();
  const spawner = new FakeProcessSpawner();
  const timers = new FakeClock();
  const logger = new RecordingLogger();
  spawner.enqueue(child);

  const packager = new FfmpegSignalPackager({
    spawner,
    timers,
    logger,
    createReadinessInspector: () => new MarkerInspector(),
  });

  return { child, spawner, timers, logger, packager };
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

describe("FfmpegSignalPackager", () => {
  it("returns a session synchronously with output available", () => {
    const { child, packager, spawner } = createHarness();

    const session = packager.start(initialItem());

    expect(session.output).toBe(child.stdout);
    expect(spawner.spawnCalls).toHaveLength(1);
    expect(spawner.spawnCalls[0]).toMatchObject({
      shell: false,
    });
    expect(spawner.spawnCalls[0]).not.toHaveProperty("env");
    expect(spawner.spawnCalls[0]?.args).toContain("pipe:1");
  });

  it("passes a resolved FFmpeg executable without forwarding config as env", () => {
    const child = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(child);
    const packager = new FfmpegSignalPackager({
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      ffmpegPath: "C:/tools/ffmpeg.exe",
      createReadinessInspector: () => new MarkerInspector(),
    });

    packager.start(initialItem());

    expect(spawner.spawnCalls[0]?.command).toBe("C:/tools/ffmpeg.exe");
    expect(spawner.spawnCalls[0]).not.toHaveProperty("env");
  });

  it("rejects invalid timing before creating a process", () => {
    const { packager, spawner } = createHarness();

    expect(() =>
      packager.start(initialItem({ playDurationMs: 0 })),
    ).toThrowError(expect.objectContaining({ code: "invalid_playout_item" }));
    expect(spawner.spawnCalls).toHaveLength(0);
  });

  it("waits for inspected usable output instead of spawn or an arbitrary byte", async () => {
    const { child, packager } = createHarness();
    const session = packager.start(initialItem());
    let settled = false;
    void session.ready.finally(() => {
      settled = true;
    });

    child.writeStdout("x");
    await Promise.resolve();
    expect(settled).toBe(false);

    child.writeStdout("usable-output");
    await expect(session.ready).resolves.toBeUndefined();
  });

  it("rejects readiness when the process fails first", async () => {
    const { child, packager } = createHarness();
    const session = packager.start(initialItem());

    child.exit({ code: 1, signal: null });

    const error = await expectSignalError(session.ready, "packaging_failed");
    expect(error.details).not.toHaveProperty("mediaPath");
    expect(JSON.stringify(error.details)).not.toContain("movie.mkv");
  });

  it("reports a clean exit before readiness as premature", async () => {
    const { child, packager } = createHarness();
    const session = packager.start(initialItem());

    child.exit({ code: 0, signal: null });

    const error = await expectSignalError(session.ready, "packaging_failed");
    expect(error.details).toMatchObject({ reason: "premature_exit" });
  });

  it("reports a clean exit after readiness but before lifecycle completion as premature", async () => {
    const { child, packager } = createHarness();
    const session = packager.start(initialItem());

    child.writeStdout("usable-output");
    await expect(session.ready).resolves.toBeUndefined();

    const completionFailure = expectSignalError(
      session.completion,
      "packaging_failed",
    );
    child.exit({ code: 0, signal: null });

    const error = await completionFailure;
    expect(error.details).toMatchObject({ reason: "premature_exit" });
  });

  it("stops before readiness, settles ready, and verifies child closure", async () => {
    const { child, packager } = createHarness();
    const session = packager.start(initialItem());
    const ready = expectSignalError(session.ready, "packaging_stopped");

    const stopped = session.stop();
    expect(child.terminationSignals).toEqual(["SIGTERM"]);
    child.exit({ code: null, signal: "SIGTERM" });

    await ready;
    await expect(stopped).resolves.toBeUndefined();
  });

  it("shares cleanup across repeated stop calls", async () => {
    const { child, packager } = createHarness();
    const session = packager.start(initialItem());
    void session.ready.catch(() => undefined);

    const first = session.stop();
    const second = session.stop();

    expect(second).toBe(first);
    child.exit({ code: null, signal: "SIGTERM" });
    await first;
  });
});
