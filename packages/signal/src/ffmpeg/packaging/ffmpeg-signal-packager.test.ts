import { describe, expect, it, vi } from "vitest";

import type { SignalPlayoutItem } from "../../signal-packager/contracts.js";
import { FakeClock } from "../../testing/fake-clock.js";
import { MarkerReadinessInspector } from "../../testing/marker-readiness-inspector.js";
import { FakeProcess, FakeProcessSpawner } from "../../testing/fake-process.js";
import { FfmpegSignalPackager } from "./ffmpeg-signal-packager.js";
import { MpegTsReadinessInspector } from "../mpeg-ts/mpeg-ts-readiness-inspector.js";
import { expectSignalError } from "../../testing/expect-signal-error.js";
import { RecordingLogger } from "../../testing/recording-logger.js";
import { transportPacket } from "../../testing/transport-packet.js";
import { flushMicrotasks } from "../../testing/settle-promises.js";
import { trackSettlement } from "../../testing/settlement-flag.js";

type ProgramItem = Extract<SignalPlayoutItem, { kind: "program" }>;

const initialItem = (overrides: Partial<ProgramItem> = {}): ProgramItem => ({
  kind: "program",
  channelId: "channel-1",
  scheduleEntryId: "entry-1",
  mediaItemId: "media-1",
  mediaPath: "C:/private/media/movie.mkv",
  hasAudio: true,
  hasVideo: true,
  mediaOffsetMs: 250,
  playDurationMs: 30_000,
  blackTailMs: 0,
  ...overrides,
});

const createHarness = () => {
  const child = new FakeProcess();
  const spawner = new FakeProcessSpawner();
  const timers = new FakeClock();
  const logger = new RecordingLogger();
  spawner.enqueue(child);

  const packager = new FfmpegSignalPackager({
    ffmpegPath: "ffmpeg",
    spawner,
    timers,
    logger,
    createReadinessInspector: () => new MarkerReadinessInspector(),
  });

  return { child, spawner, timers, logger, packager };
};

const packet = (fill: number): Buffer => transportPacket({ fill });

describe("FfmpegSignalPackager", () => {
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid committed-item readiness timeout %s",
    (itemReadinessTimeoutMs) => {
      expect(
        () =>
          new FfmpegSignalPackager({
            ffmpegPath: "ffmpeg",
            spawner: new FakeProcessSpawner(),
            timers: new FakeClock(),
            logger: new RecordingLogger(),
            itemReadinessTimeoutMs,
          }),
      ).toThrow(/positive safe integer/i);
    },
  );

  it("rejects an empty FFmpeg executable before any item starts", () => {
    const spawner = new FakeProcessSpawner();

    expect(
      () =>
        new FfmpegSignalPackager({
          ffmpegPath: "",
          spawner,
          timers: new FakeClock(),
          logger: new RecordingLogger(),
        }),
    ).toThrow(/ffmpegPath must not be empty/);
    expect(spawner.spawnCalls).toHaveLength(0);
  });

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
      createReadinessInspector: () => new MarkerReadinessInspector(),
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

  it("logs why FFmpeg failed with the item's media path redacted", async () => {
    const { child, logger, packager } = createHarness();
    const session = packager.start(initialItem());
    child.writeStderr("C:/private/media/movie.mkv: Invalid data found\n");

    child.exit({ code: 1, signal: null });

    const error = await expectSignalError(session.ready, "packaging_failed");
    expect(error.details).toMatchObject({
      stderrSummary: "[redacted]: Invalid data found",
    });
    expect(JSON.stringify(logger.errors)).not.toContain("movie.mkv");
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

    const completed = trackSettlement(session.completion);
    child.exit({ code: 0, signal: null });
    await flushMicrotasks(2);

    expect(completed.settled).toBe(false);
    expect(session.output.readableEnded).toBe(false);
  });

  it("starts the next FFmpeg process on prepare, holds its output, and releases it on commit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MpegTsReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const output = session.output;
    const forwarded: Buffer[] = [];
    output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    const held = Buffer.concat([packet(2), packet(3), packet(4)]);

    const preparation = await session.prepare(
      initialItem({
        scheduleEntryId: "entry-2",
        mediaItemId: "media-2",
        mediaPath: "C:/private/media/next.mkv",
      }),
    );

    // The process starts at once, but nothing of it reaches the broadcast
    // before the commit, however much it has emitted.
    expect(spawner.spawnCalls).toHaveLength(2);
    expect(spawner.spawnCalls[1]?.args).toContain("C:/private/media/next.mkv");
    second.writeStdout(held);
    await flushMicrotasks(2);
    expect(Buffer.concat(forwarded)).toEqual(Buffer.alloc(0));

    preparation.commit();

    expect(session.output).toBe(output);
    expect(Buffer.concat(forwarded)).toEqual(held);
    second.writeStdout(packet(5));
    await flushMicrotasks(2);
    expect(Buffer.concat(forwarded)).toEqual(Buffer.concat([held, packet(5)]));
    expect(first.terminationSignals).toEqual(["SIGTERM"]);
    first.exit({ code: null, signal: "SIGTERM" });
    await flushMicrotasks(2);
  });

  it("logs structured lifecycle measurements without exposing media paths", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const logger = new RecordingLogger();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      logger,
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    first.writeStdout("usable-output");
    await session.ready;
    const preparing = session.prepare(
      initialItem({
        scheduleEntryId: "entry-2",
        mediaItemId: "media-2",
        mediaPath: "C:/private/media/secret-next.mkv",
      }),
    );
    second.writeStdout("usable-output");
    const preparation = await preparing;
    preparation.commit();
    first.exit({ code: null, signal: "SIGTERM" });
    const stopped = session.stop();
    second.exit({ code: null, signal: "SIGTERM" });
    await stopped;

    expect(logger.infos.map(({ message }) => message)).toEqual([
      "ffmpeg_process_started",
      "signal_initial_output_ready",
      "ffmpeg_process_started",
      "signal_prepared_item_ready",
      "signal_transition_committed",
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

  it("splices only complete 188-byte packets and drops the detached FFmpeg process's partial tail", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MpegTsReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const output: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => output.push(chunk));
    const firstPacket = packet(1);
    const ready = Buffer.concat([packet(2), packet(3), packet(4)]);
    const latePacket = packet(5);

    first.writeStdout(Buffer.concat([firstPacket, Buffer.alloc(17, 9)]));
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout(Buffer.concat([ready, latePacket.subarray(0, 50)]));
    const preparation = await preparing;
    preparation.commit();
    second.writeStdout(latePacket.subarray(50));
    await flushMicrotasks(2);

    expect(Buffer.concat(output)).toEqual(
      Buffer.concat([firstPacket, ready, latePacket]),
    );
    first.exit({ code: null, signal: "SIGTERM" });
    const stopped = session.stop();
    second.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("discards a prepared item by stopping its FFmpeg process and rejects its later commit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const forwarded: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout("usable-output");
    const preparation = await preparing;
    second.writeStdout(packet(2));

    const discarding = preparation.discard();
    expect(second.terminationSignals).toEqual(["SIGTERM"]);
    second.exit({ code: null, signal: "SIGTERM" });
    await discarding;

    // What the discarded process held never reaches the broadcast.
    expect(Buffer.concat(forwarded)).toEqual(Buffer.alloc(0));
    expect(() => preparation.commit()).toThrow(/discarded/i);
    const stopped = session.stop();
    first.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("rejects a preparation whose FFmpeg process cannot start and keeps the session airing", async () => {
    const { packager, child, spawner } = createHarness();
    const session = packager.start(initialItem());
    child.writeStdout("usable-output");
    await session.ready;
    const completed = trackSettlement(session.completion);

    await expect(
      session.prepare(
        initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
      ),
    ).rejects.toMatchObject({ code: "packaging_start_failed" });
    await flushMicrotasks(2);

    expect(completed.settled).toBe(false);
    // The next preparation is free to start once a process can.
    const next = new FakeProcess();
    spawner.enqueue(next);
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-3", mediaItemId: "media-3" }),
    );
    next.writeStdout("usable-output");
    await expect(preparing).resolves.toBeDefined();
    const stopped = session.stop();
    child.exit({ code: null, signal: "SIGTERM" });
    next.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("fails the commit of a prepared process that died before its boundary", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout("usable-output");
    const preparation = await preparing;
    const completion = expectSignalError(
      session.completion,
      "packaging_failed",
    );

    second.exit({ code: 1, signal: null });
    await flushMicrotasks(2);

    expect(() => preparation.commit()).toThrowError(
      expect.objectContaining({ code: "packaging_failed" }),
    );
    await completion;
    first.exit({ code: null, signal: "SIGTERM" });
  });

  it("releases everything a short prepared item finished emitting before its commit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MpegTsReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const forwarded: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    const whole = Buffer.concat([packet(2), packet(3), packet(4), packet(5)]);
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout(whole);
    const preparation = await preparing;
    second.exit({ code: 0, signal: null });
    await flushMicrotasks(2);
    const completed = trackSettlement(session.completion);

    preparation.commit();
    await flushMicrotasks(2);

    expect(Buffer.concat(forwarded)).toEqual(whole);
    expect(completed.settled).toBe(false);
    const stopped = session.stop();
    first.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("fails the session when a prepared process holds more output than its limit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      preparedOutputLimitBytes: 188 * 4,
      createReadinessInspector: () => new MpegTsReadinessInspector(),
    });
    const session = packager.start(initialItem());
    session.output.resume();
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout(Buffer.concat([packet(2), packet(3), packet(4)]));
    await preparing;
    const completion = expectSignalError(
      session.completion,
      "packaging_failed",
    );

    second.writeStdout(Buffer.concat([packet(5), packet(6)]));

    const error = await completion;
    expect(error.details).toMatchObject({ reason: "prepared_output_limit" });
    first.exit({ code: null, signal: "SIGTERM" });
    second.exit({ code: null, signal: "SIGTERM" });
  });

  it("makes outstanding and future preparations inert once stop begins", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout("usable-output");
    const preparation = await preparing;

    const stopped = session.stop();
    expect(second.terminationSignals).toEqual(["SIGTERM"]);
    second.exit({ code: null, signal: "SIGTERM" });
    await expect(preparation.discard()).resolves.toBeUndefined();
    expect(() => preparation.commit()).toThrow();
    await expect(
      session.prepare(
        initialItem({ scheduleEntryId: "entry-3", mediaItemId: "media-3" }),
      ),
    ).rejects.toMatchObject({ code: "packaging_stopped" });

    first.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("fails the session when a committed FFmpeg process produces no usable output in time", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers,
      logger: new RecordingLogger(),
      itemReadinessTimeoutMs: 25,
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    session.output.resume();
    first.writeStdout("usable-output");
    await session.ready;
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    // The boundary arrives before the process says anything: the commit goes
    // ahead, and the readiness timeout, counted from its start, still bounds it.
    preparation.commit();
    first.exit({ code: null, signal: "SIGTERM" });
    const completion = expectSignalError(
      session.completion,
      "packaging_failed",
    );

    timers.advanceBy(25);

    const error = await completion;
    expect(error.details).toMatchObject({ reason: "item_readiness_timeout" });
    expect(second.terminationSignals).toEqual(["SIGTERM"]);
    second.exit({ code: null, signal: "SIGTERM" });
  });

  it("stops every FFmpeg process retained across a committed transition before settling", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    session.output.resume();
    const outputEnded = new Promise<void>((resolve) => {
      session.output.once("end", resolve);
    });
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout("usable-output");
    const preparation = await preparing;
    preparation.commit();

    const stopped = session.stop();
    let settled = false;
    void stopped.finally(() => {
      settled = true;
    });
    expect(first.terminationSignals).toEqual(["SIGTERM"]);
    expect(second.terminationSignals).toEqual(["SIGTERM"]);
    second.exit({ code: null, signal: "SIGTERM" });
    await flushMicrotasks(2);
    expect(settled).toBe(false);

    first.exit({ code: null, signal: "SIGTERM" });
    await expect(stopped).resolves.toBeUndefined();
    await expect(session.completion).resolves.toBeUndefined();
    await outputEnded;
    expect(session.output.readableEnded).toBe(true);
  });

  it("rejects completion when a later FFmpeg process fails", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const logger = new RecordingLogger();
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      logger,
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    session.output.resume();
    const outputEnded = new Promise<void>((resolve) => {
      session.output.once("end", resolve);
    });
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout("usable-output");
    const preparation = await preparing;
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

  it("stops a prepared process that produces no usable output in time and fails its later commit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers,
      logger: new RecordingLogger(),
      itemReadinessTimeoutMs: 25,
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const forwarded: Buffer[] = [];
    const outputError = vi.fn();
    session.output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    session.output.on("error", outputError);
    first.writeStdout("usable-output");
    await session.ready;
    const completed = trackSettlement(session.completion);
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );

    timers.advanceBy(24);
    await flushMicrotasks(2);
    expect(second.terminationSignals).toEqual([]);
    timers.advanceBy(1);
    await flushMicrotasks(2);

    // The airing item plays on; the silent process is stopped and never
    // reaches the output, and the commit that would have aired it fails.
    expect(second.terminationSignals).toEqual(["SIGTERM"]);
    expect(second.stdout.listenerCount("data")).toBe(0);
    expect(completed.settled).toBe(false);
    const bytesAtFailure = Buffer.concat(forwarded);
    second.writeStdout(packet(7));
    await flushMicrotasks(2);
    expect(Buffer.concat(forwarded)).toEqual(bytesAtFailure);
    expect(outputError).not.toHaveBeenCalled();
    second.exit({ code: null, signal: "SIGTERM" });
    const completion = expectSignalError(
      session.completion,
      "packaging_failed",
    );
    expect(() => preparation.commit()).toThrowError(
      expect.objectContaining({ code: "packaging_failed" }),
    );
    const error = await completion;
    expect(error.details).toMatchObject({ reason: "item_readiness_timeout" });
    first.exit({ code: null, signal: "SIGTERM" });
  });

  it("cancels each prepared FFmpeg process readiness timeout on usable output", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers,
      logger: new RecordingLogger(),
      itemReadinessTimeoutMs: 25,
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    first.writeStdout("usable-output");
    await session.ready;
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout("usable-output");
    const preparation = await preparing;
    preparation.commit();
    first.exit({ code: null, signal: "SIGTERM" });

    timers.advanceBy(25);
    await flushMicrotasks(2);
    const completed = trackSettlement(session.completion);
    await flushMicrotasks(2);
    expect(completed.settled).toBe(false);

    const stopped = session.stop();
    second.exit({ code: null, signal: "SIGTERM" });
    await stopped;
    expect(timers.pendingTimerCount).toBe(0);
  });

  it("feeds an old FFmpeg process stop failure into session completion", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      ffmpegPath: "ffmpeg",
      spawner,
      timers,
      logger: new RecordingLogger(),
      terminationGraceMs: 10,
      itemReadinessTimeoutMs: 100,
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    first.writeStdout("usable-output");
    await session.ready;
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout("usable-output");
    const preparation = await preparing;
    preparation.commit();
    const completion = expectSignalError(
      session.completion,
      "runtime_cleanup_failed",
    );

    timers.advanceBy(10);
    await flushMicrotasks(2);
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
    await flushMicrotasks(2);
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
