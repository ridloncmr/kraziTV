import { describe, expect, it, vi } from "vitest";

import { SignalError } from "../../errors.js";
import type { SignalLogger } from "../../runtime/signal-logger.js";
import type { SignalPlayoutItem } from "../../signal-packager/contracts.js";
import { FakeClock } from "../../testing/fake-clock.js";
import { FakeProcess, FakeProcessSpawner } from "../../testing/fake-process.js";
import { FfmpegSignalPackager } from "./ffmpeg-signal-packager.js";
import type { OutputReadinessInspector } from "../mpeg-ts/mpeg-ts-readiness-inspector.js";

class RecordingLogger implements SignalLogger {
  readonly infos: Array<{
    message: string;
    context?: Readonly<Record<string, unknown>>;
  }> = [];
  readonly errors: Array<{
    message: string;
    context?: Readonly<Record<string, unknown>>;
  }> = [];

  /** Ignores debug output outside these lifecycle assertions. */
  debug(): void {}

  /** Retains lifecycle measurements for stable event assertions. */
  info(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.infos.push({ message, context });
  }

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
  hasAudio: true,
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

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const packet = (fill: number): Buffer => {
  const bytes = Buffer.alloc(188, fill);
  bytes[0] = 0x47;
  return bytes;
};

describe("FfmpegSignalPackager", () => {
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid committed-item readiness timeout %s",
    (itemReadinessTimeoutMs) => {
      expect(
        () =>
          new FfmpegSignalPackager({
            spawner: new FakeProcessSpawner(),
            timers: new FakeClock(),
            logger: new RecordingLogger(),
            itemReadinessTimeoutMs,
          }),
      ).toThrow(/positive safe integer/i);
    },
  );

  it("returns a session synchronously with session-owned output available", () => {
    const { child, packager, spawner } = createHarness();

    const session = packager.start(initialItem());

    expect(session.output).not.toBe(child.stdout);
    expect(spawner.spawnCalls).toHaveLength(1);
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

  it("keeps the session alive when one item exits cleanly", async () => {
    const { child, packager } = createHarness();
    const session = packager.start(initialItem());

    child.writeStdout("usable-output");
    await expect(session.ready).resolves.toBeUndefined();

    let completed = false;
    void session.completion.finally(() => {
      completed = true;
    });
    child.exit({ code: 0, signal: null });
    await flushPromises();

    expect(completed).toBe(false);
    expect(session.output.readableEnded).toBe(false);
  });

  it("prepares without spawning, then synchronously starts the next encoder on commit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerInspector(),
    });
    const session = packager.start(initialItem());
    const output = session.output;

    const preparation = await session.prepare(
      initialItem({
        scheduleEntryId: "entry-2",
        mediaItemId: "media-2",
        mediaPath: "C:/private/media/next.mkv",
      }),
    );
    expect(spawner.spawnCalls).toHaveLength(1);

    preparation.commit();

    expect(session.output).toBe(output);
    expect(spawner.spawnCalls).toHaveLength(2);
    expect(spawner.spawnCalls[1]?.args).toContain("C:/private/media/next.mkv");
    expect(first.terminationSignals).toEqual(["SIGTERM"]);
    first.exit({ code: null, signal: "SIGTERM" });
    await flushPromises();
  });

  it("logs structured lifecycle measurements without exposing media paths", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const logger = new RecordingLogger();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      spawner,
      timers: new FakeClock(),
      logger,
      createReadinessInspector: () => new MarkerInspector(),
    });
    const session = packager.start(initialItem());
    first.writeStdout("usable-output");
    await session.ready;
    const preparation = await session.prepare(
      initialItem({
        scheduleEntryId: "entry-2",
        mediaItemId: "media-2",
        mediaPath: "C:/private/media/secret-next.mkv",
      }),
    );
    preparation.commit();
    second.writeStdout("usable-output");
    first.exit({ code: null, signal: "SIGTERM" });
    const stopped = session.stop();
    second.exit({ code: null, signal: "SIGTERM" });
    await stopped;

    expect(logger.infos.map(({ message }) => message)).toEqual([
      "ffmpeg_process_started",
      "signal_initial_output_ready",
      "ffmpeg_process_started",
      "signal_transition_committed",
      "signal_committed_item_ready",
      "signal_session_stopped",
    ]);
    expect(logger.infos[3]?.context).toMatchObject({
      channelId: "channel-1",
      scheduleEntryId: "entry-2",
      mediaItemId: "media-2",
    });
    expect(JSON.stringify(logger.infos)).not.toContain("secret-next.mkv");
    expect(JSON.stringify(logger.infos)).not.toContain("movie.mkv");
  });

  it("splices only complete 188-byte packets and drops the detached encoder's partial tail", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerInspector(),
    });
    const session = packager.start(initialItem());
    const output: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => output.push(chunk));
    const firstPacket = packet(1);
    const secondPacket = packet(2);

    first.writeStdout(Buffer.concat([firstPacket, Buffer.alloc(17, 9)]));
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    preparation.commit();
    second.writeStdout(secondPacket.subarray(0, 50));
    second.writeStdout(secondPacket.subarray(50));
    await flushPromises();

    expect(Buffer.concat(output)).toEqual(
      Buffer.concat([firstPacket, secondPacket]),
    );
    first.exit({ code: null, signal: "SIGTERM" });
    const stopped = session.stop();
    second.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("discards a prepared item without spawning and rejects its later commit", async () => {
    const { packager, spawner, child } = createHarness();
    const session = packager.start(initialItem());
    session.output.resume();
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );

    await preparation.discard();

    expect(spawner.spawnCalls).toHaveLength(1);
    expect(() => preparation.commit()).toThrow(/discarded/i);
    const stopped = session.stop();
    child.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("consumes a preparation when its synchronous encoder start fails", async () => {
    const { packager, child } = createHarness();
    const session = packager.start(initialItem());
    const completion = expectSignalError(
      session.completion,
      "packaging_start_failed",
    );
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );

    expect(() => preparation.commit()).toThrowError(
      expect.objectContaining({ code: "packaging_start_failed" }),
    );
    expect(() => preparation.commit()).toThrow(/already committed/i);
    await expect(preparation.discard()).resolves.toBeUndefined();

    child.exit({ code: null, signal: "SIGTERM" });
    await completion;
  });

  it("makes outstanding and future preparations inert once stop begins", async () => {
    const { packager, child } = createHarness();
    const session = packager.start(initialItem());
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );

    const stopped = session.stop();
    await expect(preparation.discard()).resolves.toBeUndefined();
    expect(() => preparation.commit()).toThrow();
    await expect(
      session.prepare(
        initialItem({ scheduleEntryId: "entry-3", mediaItemId: "media-3" }),
      ),
    ).rejects.toMatchObject({ code: "packaging_stopped" });

    child.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("stops every encoder retained across a committed transition before settling", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerInspector(),
    });
    const session = packager.start(initialItem());
    session.output.resume();
    const outputEnded = new Promise<void>((resolve) => {
      session.output.once("end", resolve);
    });
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    preparation.commit();

    const stopped = session.stop();
    let settled = false;
    void stopped.finally(() => {
      settled = true;
    });
    expect(first.terminationSignals).toEqual(["SIGTERM"]);
    expect(second.terminationSignals).toEqual(["SIGTERM"]);
    second.exit({ code: null, signal: "SIGTERM" });
    await flushPromises();
    expect(settled).toBe(false);

    first.exit({ code: null, signal: "SIGTERM" });
    await expect(stopped).resolves.toBeUndefined();
    await expect(session.completion).resolves.toBeUndefined();
    await outputEnded;
    expect(session.output.readableEnded).toBe(true);
  });

  it("rejects completion when a later encoder fails", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const logger = new RecordingLogger();
    const packager = new FfmpegSignalPackager({
      spawner,
      timers: new FakeClock(),
      logger,
      createReadinessInspector: () => new MarkerInspector(),
    });
    const session = packager.start(initialItem());
    session.output.resume();
    const outputEnded = new Promise<void>((resolve) => {
      session.output.once("end", resolve);
    });
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    preparation.commit();
    const failed = expectSignalError(session.completion, "packaging_failed");

    second.exit({ code: 1, signal: null });

    await failed;
    await outputEnded;
    expect(session.output.readableEnded).toBe(true);
    expect(logger.infos.at(-1)).toMatchObject({
      message: "signal_session_failed",
      context: {
        channelId: "channel-1",
        scheduleEntryId: "entry-2",
        mediaItemId: "media-2",
      },
    });
    first.exit({ code: null, signal: "SIGTERM" });
  });

  it("fails the session when a committed encoder produces no usable output", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      spawner,
      timers,
      logger: new RecordingLogger(),
      itemReadinessTimeoutMs: 25,
      createReadinessInspector: () => new MarkerInspector(),
    });
    const session = packager.start(initialItem());
    const forwarded: Buffer[] = [];
    const outputError = vi.fn();
    session.output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    session.output.on("error", outputError);
    first.writeStdout("usable-output");
    await session.ready;
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    preparation.commit();
    first.exit({ code: null, signal: "SIGTERM" });
    const completion = expectSignalError(
      session.completion,
      "packaging_failed",
    );

    timers.advanceBy(24);
    await flushPromises();
    expect(second.terminationSignals).toEqual([]);
    timers.advanceBy(1);

    const error = await completion;
    expect(error.details).toMatchObject({ reason: "item_readiness_timeout" });
    expect(second.terminationSignals).toEqual(["SIGTERM"]);
    expect(second.stdout.listenerCount("data")).toBe(0);
    const bytesAtFailure = Buffer.concat(forwarded);
    second.writeStdout(packet(7));
    await flushPromises();
    expect(Buffer.concat(forwarded)).toEqual(bytesAtFailure);
    expect(outputError).not.toHaveBeenCalled();
    second.exit({ code: null, signal: "SIGTERM" });
  });

  it("cancels each committed encoder readiness timeout on usable output", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      spawner,
      timers,
      logger: new RecordingLogger(),
      itemReadinessTimeoutMs: 25,
      createReadinessInspector: () => new MarkerInspector(),
    });
    const session = packager.start(initialItem());
    first.writeStdout("usable-output");
    await session.ready;
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    preparation.commit();
    first.exit({ code: null, signal: "SIGTERM" });

    second.writeStdout("usable-output");
    timers.advanceBy(25);
    await flushPromises();
    let completed = false;
    void session.completion.finally(() => {
      completed = true;
    });
    await flushPromises();
    expect(completed).toBe(false);

    const stopped = session.stop();
    second.exit({ code: null, signal: "SIGTERM" });
    await stopped;
    expect(timers.pendingTimerCount).toBe(0);
  });

  it("feeds an old encoder stop failure into session completion", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      spawner,
      timers,
      logger: new RecordingLogger(),
      terminationGraceMs: 10,
      itemReadinessTimeoutMs: 100,
      createReadinessInspector: () => new MarkerInspector(),
    });
    const session = packager.start(initialItem());
    first.writeStdout("usable-output");
    await session.ready;
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    preparation.commit();
    second.writeStdout("usable-output");
    const completion = expectSignalError(
      session.completion,
      "runtime_cleanup_failed",
    );

    timers.advanceBy(10);
    await flushPromises();
    timers.advanceBy(10);

    await completion;
    expect(second.terminationSignals).toEqual(["SIGTERM"]);
    first.exit({ code: null, signal: "SIGKILL" });
    second.exit({ code: null, signal: "SIGTERM" });
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

  it("retries process cleanup after a shared stop attempt fails", async () => {
    const { child, packager, timers } = createHarness();
    const session = packager.start(initialItem());
    void session.ready.catch(() => undefined);

    const first = session.stop();
    const concurrent = session.stop();
    expect(concurrent).toBe(first);
    timers.advanceBy(5_000);
    await flushPromises();
    timers.advanceBy(5_000);
    await expect(first).rejects.toMatchObject({
      code: "runtime_cleanup_failed",
    });

    const retry = session.stop();
    const concurrentRetry = session.stop();
    expect(retry).not.toBe(first);
    expect(concurrentRetry).toBe(retry);
    child.exit({ code: null, signal: "SIGTERM" });
    await expect(retry).resolves.toBeUndefined();
    expect(session.stop()).toBe(retry);
    expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL", "SIGTERM"]);
  });
});
