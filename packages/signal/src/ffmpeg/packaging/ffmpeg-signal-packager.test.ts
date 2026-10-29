import { describe, expect, it, vi } from "vitest";

import type { SignalPlayoutItem } from "../../signal-packager/contracts.js";
import { FakeClock } from "../../testing/fake-clock.js";
import { MarkerReadinessInspector } from "../../testing/marker-readiness-inspector.js";
import { FakeProcess, FakeProcessSpawner } from "../../testing/fake-process.js";
import { FfmpegSignalPackager } from "./ffmpeg-signal-packager.js";
import {
  VIDEO_PID,
  pesTimestampFields,
  readTimestamp,
} from "../mpeg-ts/mpeg-ts-packet-run.js";
import { MpegTsReadinessInspector } from "../mpeg-ts/mpeg-ts-readiness-inspector.js";
import { expectSignalError } from "../../testing/expect-signal-error.js";
import { RecordingLogger } from "../../testing/recording-logger.js";
import { transportPacket } from "../../testing/transport-packet.js";
import {
  flushMicrotasks,
  settlePromises,
} from "../../testing/settle-promises.js";
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
    isMediaPresent: presentMedia,
    ffmpegPath: "ffmpeg",
    spawner,
    timers,
    clock: timers,
    logger,
    createReadinessInspector: () => new MarkerReadinessInspector(),
  });

  return { child, spawner, timers, logger, packager };
};

const packet = (fill: number): Buffer => transportPacket({ fill });

/**
 * The readiness marker as one whole transport packet, for tests whose later
 * packets must stay aligned through the same process's forwarder.
 */
const markerPacket = (): Buffer => {
  const marked = packet(9);
  marked.write("usable-output", 20);
  return marked;
};
const pat = (): Buffer => transportPacket({ pid: 0, fill: 1 });
const videoKeyframe = (): Buffer =>
  transportPacket({ pid: VIDEO_PID, keyframe: true });
const videoFrameStart = (): Buffer =>
  transportPacket({ pid: VIDEO_PID, pesStart: true });
const videoFrame = (fill: number): Buffer =>
  transportPacket({ pid: VIDEO_PID, fill });

/** Clears each packet's continuity counter, which the session rewrites. */
const withoutCounters = (packets: Buffer): Buffer => {
  const cleared = Buffer.from(packets);
  for (let offset = 3; offset < cleared.byteLength; offset += 188) {
    cleared[offset] = (cleared[offset] ?? 0) & 0xf0;
  }
  return cleared;
};

/** Every media path exists, so only tests about missing media see a stand-in prepared. */
const presentMedia = async (): Promise<boolean> => true;

/** Asserts the offline card over silence that reads no media, as a stand-in airs. */
const expectStandInArguments = (args: readonly string[] | undefined): void => {
  expect(args).toContain("color=c=black:s=1920x1080:r=30");
  expect(args).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
  expect(args?.join(" ")).not.toContain("movie.mkv");
  expect(args?.join(" ")).toContain("text=Programming offline");
};

describe("FfmpegSignalPackager", () => {
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid committed-item readiness timeout %s",
    (itemReadinessTimeoutMs) => {
      expect(
        () =>
          new FfmpegSignalPackager({
            isMediaPresent: presentMedia,
            ffmpegPath: "ffmpeg",
            spawner: new FakeProcessSpawner(),
            timers: new FakeClock(),
            clock: new FakeClock(),
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
          isMediaPresent: presentMedia,
          ffmpegPath: "",
          spawner,
          timers: new FakeClock(),
          clock: new FakeClock(),
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
      isMediaPresent: presentMedia,
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
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

  it("airs a stand-in when the first process fails before readiness", async () => {
    const { child, packager, spawner, logger } = createHarness();
    const standIn = new FakeProcess();
    spawner.enqueue(standIn);
    const session = packager.start(initialItem());
    const completed = trackSettlement(session.completion);

    child.exit({ code: 1, signal: null });
    await child.exited;
    await flushMicrotasks(2);

    // A tune waits on readiness, so a missing or unreadable file still lets
    // the viewer in, to the offline card rather than an error.
    expect(spawner.spawnCalls).toHaveLength(2);
    expectStandInArguments(spawner.spawnCalls[1]?.args);
    standIn.writeStdout("usable-output");
    await expect(session.ready).resolves.toBeUndefined();
    expect(completed.settled).toBe(false);
    expect(logger.warns).toContainEqual(
      expect.objectContaining({
        message: "signal_item_replaced_by_stand_in",
        context: expect.objectContaining({
          scheduleEntryId: "entry-1",
          code: "packaging_failed",
        }),
      }),
    );
    const stopped = session.stop();
    standIn.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("logs why FFmpeg failed with the item's media path redacted", async () => {
    const { child, logger, packager, spawner } = createHarness();
    spawner.enqueue(new FakeProcess());
    packager.start(initialItem());
    child.writeStderr("C:/private/media/movie.mkv: Invalid data found\n");

    child.exit({ code: 1, signal: null });
    await child.exited;
    await flushMicrotasks(2);

    expect(logger.errors).toContainEqual(
      expect.objectContaining({
        context: expect.objectContaining({
          stderrSummary: "[redacted]: Invalid data found",
        }),
      }),
    );
    expect(JSON.stringify(logger.errors)).not.toContain("movie.mkv");
    expect(JSON.stringify(logger.warns)).not.toContain("movie.mkv");
  });

  it("airs a stand-in for a clean exit before readiness, reported as premature", async () => {
    const { child, packager, spawner, logger } = createHarness();
    spawner.enqueue(new FakeProcess());
    packager.start(initialItem());

    child.exit({ code: 0, signal: null });
    await child.exited;
    await flushMicrotasks(2);

    expectStandInArguments(spawner.spawnCalls[1]?.args);
    expect(logger.warns).toContainEqual(
      expect.objectContaining({
        message: "signal_item_replaced_by_stand_in",
        context: expect.objectContaining({ reason: "premature_exit" }),
      }),
    );
  });

  it("fails the session when its stand-in fails too", async () => {
    const { child, packager, spawner } = createHarness();
    const standIn = new FakeProcess();
    spawner.enqueue(standIn);
    const session = packager.start(initialItem());
    const failed = expectSignalError(session.completion, "packaging_failed");

    child.exit({ code: 1, signal: null });
    await child.exited;
    await flushMicrotasks(2);
    standIn.exit({ code: 1, signal: null });

    await failed;
    await expectSignalError(session.ready, "packaging_failed");
    expect(spawner.spawnCalls).toHaveLength(2);
  });

  it("fails the session when its stand-in cannot start", async () => {
    // Nothing is arranged for the stand-in, so its spawn throws.
    const { child, packager } = createHarness();
    const session = packager.start(initialItem());

    child.exit({ code: 1, signal: null });

    await expectSignalError(session.completion, "packaging_start_failed");
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

  it("replaces an airing process that hangs silent with a stand-in", async () => {
    const { child, packager, spawner, timers, logger } = createHarness();
    const standIn = new FakeProcess();
    spawner.enqueue(standIn);
    const session = packager.start(initialItem());
    const completed = trackSettlement(session.completion);
    child.writeStdout("usable-output");
    await session.ready;

    timers.advanceBy(4_999);
    expect(spawner.spawnCalls).toHaveLength(1);
    timers.advanceBy(1);

    expectStandInArguments(spawner.spawnCalls[1]?.args);
    // Kept alive behind the card, in case it writes again.
    expect(child.terminationSignals).toEqual([]);
    expect(logger.warns).toContainEqual(
      expect.objectContaining({
        message: "signal_item_replaced_by_stand_in",
        context: expect.objectContaining({ reason: "output_stalled" }),
      }),
    );
    expect(completed.settled).toBe(false);
    const stopped = session.stop();
    child.exit({ code: null, signal: "SIGTERM" });
    standIn.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("arms no stall timer for output FFmpeg writes while stopping", async () => {
    const { child, packager, timers } = createHarness();
    const session = packager.start(initialItem());
    child.writeStdout(markerPacket());
    await session.ready;

    const stopped = session.stop();
    // FFmpeg flushes its muxer on SIGTERM before it exits.
    child.writeStdout(packet(1));
    child.exit({ code: null, signal: "SIGTERM" });
    await stopped;

    expect(timers.pendingTimerCount).toBe(0);
  });

  it("keeps an airing process whose output keeps arriving", async () => {
    const { child, packager, spawner, timers } = createHarness();
    const session = packager.start(initialItem());
    child.writeStdout("usable-output");
    await session.ready;

    for (let tick = 0; tick < 3; tick += 1) {
      timers.advanceBy(4_000);
      child.writeStdout(packet(tick));
    }

    expect(spawner.spawnCalls).toHaveLength(1);
    const stopped = session.stop();
    child.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("replaces a program whose media ends before its airtime with a stand-in", async () => {
    const { child, packager, spawner, timers, logger } = createHarness();
    spawner.enqueue(new FakeProcess());
    const session = packager.start(initialItem());
    child.writeStdout("usable-output");
    await session.ready;

    // The file was shorter than its probe said: FFmpeg finishes cleanly
    // long before the boundary.
    child.exit({ code: 0, signal: null });
    await flushMicrotasks(2);
    timers.advanceBy(5_000);

    expectStandInArguments(spawner.spawnCalls[1]?.args);
    expect(logger.warns).toContainEqual(
      expect.objectContaining({
        context: expect.objectContaining({ reason: "output_stalled" }),
      }),
    );
  });

  it("watches the committed process, not the one that ended at its boundary", async () => {
    const { child, packager, spawner, timers, logger } = createHarness();
    const second = new FakeProcess();
    const standIn = new FakeProcess();
    spawner.enqueue(second);
    spawner.enqueue(standIn);
    const session = packager.start(initialItem());
    child.writeStdout("usable-output");
    await session.ready;
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout("usable-output");

    child.exit({ code: 0, signal: null });
    await flushMicrotasks(2);
    timers.advanceBy(1_000);
    preparation.commit();
    timers.advanceBy(4_000);
    second.writeStdout(packet(1));
    timers.advanceBy(4_000);

    expect(spawner.spawnCalls).toHaveLength(2);
    expect(logger.warns).toEqual([]);

    // Five seconds after its last chunk, the committed process counts as hung.
    timers.advanceBy(1_000);
    expectStandInArguments(spawner.spawnCalls[2]?.args);
    const stopped = session.stop();
    second.exit({ code: null, signal: "SIGTERM" });
    standIn.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("fails the session when its stand-in falls silent", async () => {
    const { child, packager, spawner, timers } = createHarness();
    const standIn = new FakeProcess();
    spawner.enqueue(standIn);
    const session = packager.start(initialItem());
    const failed = expectSignalError(session.completion, "packaging_failed");
    child.exit({ code: 1, signal: null });
    await child.exited;
    await flushMicrotasks(2);
    standIn.writeStdout("usable-output");

    timers.advanceBy(5_000);

    await failed;
    expect(spawner.spawnCalls).toHaveLength(2);
  });

  it("returns to a stalled process once it writes again, from its next keyframe", async () => {
    const { child, packager, spawner, timers, logger } = createHarness();
    const standIn = new FakeProcess();
    const secondStandIn = new FakeProcess();
    spawner.enqueue(standIn);
    spawner.enqueue(secondStandIn);
    const session = packager.start(initialItem());
    const forwarded: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    child.writeStdout(markerPacket());
    await session.ready;
    timers.advanceBy(5_000);
    standIn.writeStdout(packet(4));
    await flushMicrotasks(2);
    const beforeResume = Buffer.concat(forwarded).byteLength;

    // It writes again mid-frame: nothing before the next program tables and
    // keyframe airs, so the splice back never starts on a broken frame.
    child.writeStdout(
      Buffer.concat([videoFrame(5), pat(), videoKeyframe(), videoFrameStart()]),
    );
    await flushMicrotasks(2);

    expect(standIn.terminationSignals).toEqual(["SIGTERM"]);
    expect(
      withoutCounters(Buffer.concat(forwarded).subarray(beforeResume)),
    ).toEqual(withoutCounters(Buffer.concat([pat(), videoKeyframe()])));
    expect(logger.infos).toContainEqual(
      expect.objectContaining({
        message: "signal_item_resumed",
        context: expect.objectContaining({ scheduleEntryId: "entry-1" }),
      }),
    );
    standIn.writeStdout(packet(6));
    await flushMicrotasks(2);
    expect(Buffer.concat(forwarded).includes(packet(6))).toBe(false);

    // The returned item is watched again, so a second stall brings the card back.
    timers.advanceBy(5_000);
    expectStandInArguments(spawner.spawnCalls[2]?.args);
    const stopped = session.stop();
    child.exit({ code: null, signal: "SIGTERM" });
    standIn.exit({ code: null, signal: "SIGTERM" });
    secondStandIn.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("stops a stalled process that never writes again at the next commit", async () => {
    const { child, packager, spawner, timers } = createHarness();
    const standIn = new FakeProcess();
    const second = new FakeProcess();
    spawner.enqueue(standIn);
    spawner.enqueue(second);
    const session = packager.start(initialItem());
    child.writeStdout(markerPacket());
    await session.ready;
    timers.advanceBy(5_000);
    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    second.writeStdout("usable-output");

    preparation.commit();

    expect(child.terminationSignals).toEqual(["SIGTERM"]);
    expect(standIn.terminationSignals).toEqual(["SIGTERM"]);
    child.writeStdout(
      Buffer.concat([pat(), videoKeyframe(), videoFrameStart()]),
    );
    await flushMicrotasks(2);
    expect(standIn.terminationSignals).toEqual(["SIGTERM"]);
    const stopped = session.stop();
    child.exit({ code: null, signal: "SIGTERM" });
    standIn.exit({ code: null, signal: "SIGTERM" });
    second.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("keeps the stand-in when a stalled process exits instead of writing again", async () => {
    const { child, packager, spawner, timers } = createHarness();
    const standIn = new FakeProcess();
    spawner.enqueue(standIn);
    const session = packager.start(initialItem());
    const completed = trackSettlement(session.completion);
    child.writeStdout(markerPacket());
    await session.ready;
    timers.advanceBy(5_000);

    child.exit({ code: 1, signal: null });
    await flushMicrotasks(2);

    expect(standIn.terminationSignals).toEqual([]);
    expect(completed.settled).toBe(false);
    expect(spawner.spawnCalls).toHaveLength(2);
    const stopped = session.stop();
    standIn.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("fails the session when its stand-in never produces output", async () => {
    const { child, packager, spawner, timers } = createHarness();
    spawner.enqueue(new FakeProcess());
    const session = packager.start(initialItem());
    const failed = expectSignalError(session.completion, "packaging_failed");
    child.exit({ code: 1, signal: null });
    await child.exited;
    await flushMicrotasks(2);

    timers.advanceBy(15_000);

    await failed;
  });

  it("tunes only the session's first process for a fast start and the join backlog", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());

    await session.prepare(initialItem({ scheduleEntryId: "entry-2" }));

    // A tune request waits on the first process; a prepared one has its lead.
    expect(spawner.spawnCalls[0]?.args).toContain("veryfast");
    expect(spawner.spawnCalls[1]?.args).not.toContain("veryfast");
    expect(spawner.spawnCalls[1]?.args).not.toContain("zerolatency");
    // Only the first process bursts the backlog its first viewer joins with.
    expect(spawner.spawnCalls[0]?.args).toContain("-readrate_initial_burst");
    expect(spawner.spawnCalls[1]?.args).not.toContain(
      "-readrate_initial_burst",
    );
    const stopped = session.stop();
    first.exit({ code: null, signal: "SIGTERM" });
    second.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("holds a first viewer's readiness until the burst backlog is written", async () => {
    const child = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(child);
    const clock = new FakeClock();
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: clock,
      clock,
      logger: new RecordingLogger(),
    });
    // Three seconds in: a three-second burst ends on its fourth keyframe.
    const session = packager.start(initialItem({ mediaOffsetMs: 3_000 }));
    session.output.resume();
    const ready = trackSettlement(session.ready);
    const keyframe = transportPacket({ pid: 256, keyframe: true });

    child.writeStdout(Buffer.concat([keyframe, keyframe, keyframe]));
    await flushMicrotasks(2);
    expect(ready.settled).toBe(false);

    child.writeStdout(keyframe);
    await flushMicrotasks(2);
    expect(ready.settled).toBe(true);
    const stopped = session.stop();
    child.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("starts the next FFmpeg process on prepare, holds its output, and releases it on commit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
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

  it("continues the airing item's timestamps when the committed process starts its own over", async () => {
    const { child: first, spawner, packager } = createHarness();
    const second = new FakeProcess();
    spawner.enqueue(second);
    const session = packager.start(initialItem());
    const forwarded: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    // Every FFmpeg process stamps its first frame at 1.4 s.
    const frameAt = (dts: number) =>
      transportPacket({ pid: VIDEO_PID, pts: dts, dts });
    first.writeStdout(Buffer.concat([frameAt(126_000), frameAt(129_000)]));
    first.writeStdout(frameAt(132_000));
    await flushMicrotasks(2);

    const preparation = await session.prepare(
      initialItem({ scheduleEntryId: "entry-2" }),
    );
    second.writeStdout(Buffer.concat([frameAt(126_000), frameAt(129_000)]));
    await flushMicrotasks(2);
    preparation.commit();
    // Starting a third frame finishes the second.
    second.writeStdout(frameAt(132_000));
    await flushMicrotasks(2);

    // The first process's last frame was unfinished, so the commit dropped
    // it, and the committed process's frames follow the last one written.
    const written = Buffer.concat(forwarded);
    const dtsValues = [];
    for (let offset = 0; offset < written.byteLength; offset += 188) {
      const fields = pesTimestampFields(written, offset);
      if (fields?.dtsAt !== undefined) {
        dtsValues.push(readTimestamp(written, fields.dtsAt));
      }
    }
    expect(dtsValues).toEqual([126_000, 129_000, 132_000, 135_000]);
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
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
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
    const preparation = await preparing;
    second.writeStdout("usable-output");
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
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
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
    const preparation = await preparing;
    second.writeStdout(Buffer.concat([ready, latePacket.subarray(0, 50)]));
    await settlePromises();
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
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const forwarded: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    const preparation = await preparing;
    second.writeStdout("usable-output");
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

  it("airs a stand-in at the commit of a prepared process that died before its boundary", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const standIn = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    spawner.enqueue(standIn);
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const forwarded: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    first.writeStdout("usable-output");
    await session.ready;
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    const preparation = await preparing;
    second.writeStdout("usable-output");
    const completed = trackSettlement(session.completion);

    second.exit({ code: 1, signal: null });
    await second.exited;
    await flushMicrotasks(2);
    // The airing item plays on until the boundary.
    expect(spawner.spawnCalls).toHaveLength(2);
    expect(first.terminationSignals).toEqual([]);

    preparation.commit();

    expectStandInArguments(spawner.spawnCalls[2]?.args);
    expect(first.terminationSignals).toEqual(["SIGTERM"]);
    standIn.writeStdout(packet(3));
    await flushMicrotasks(2);
    expect(Buffer.concat(forwarded).subarray(-188)).toEqual(packet(3));
    expect(completed.settled).toBe(false);
    const stopped = session.stop();
    first.exit({ code: null, signal: "SIGTERM" });
    standIn.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });
  it("releases everything a short prepared item finished emitting before its commit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
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
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
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
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    const preparation = await preparing;
    second.writeStdout("usable-output");

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

  it("replaces a committed FFmpeg process that produces no usable output in time with a stand-in", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const standIn = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    spawner.enqueue(standIn);
    const logger = new RecordingLogger();
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers,
      clock: timers,
      logger,
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
    const completed = trackSettlement(session.completion);

    timers.advanceBy(25);
    await flushMicrotasks(2);

    expect(second.terminationSignals).toEqual(["SIGTERM"]);
    expectStandInArguments(spawner.spawnCalls[2]?.args);
    expect(logger.warns).toContainEqual(
      expect.objectContaining({
        message: "signal_item_replaced_by_stand_in",
        context: expect.objectContaining({
          scheduleEntryId: "entry-2",
          reason: "item_readiness_timeout",
        }),
      }),
    );
    expect(completed.settled).toBe(false);
    const stopped = session.stop();
    second.exit({ code: null, signal: "SIGTERM" });
    standIn.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });
  it("prepares a stand-in instead of FFmpeg for media that is not there", async () => {
    const first = new FakeProcess();
    const standIn = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(standIn);
    const logger = new RecordingLogger();
    const checked: string[] = [];
    const packager = new FfmpegSignalPackager({
      isMediaPresent: async (mediaPath) => {
        checked.push(mediaPath);
        return false;
      },
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
      logger,
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const forwarded: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    first.writeStdout("usable-output");
    await session.ready;

    const preparation = await session.prepare(
      initialItem({
        scheduleEntryId: "entry-2",
        mediaItemId: "media-2",
        mediaPath: "C:/private/media/gone.mkv",
      }),
    );

    // Started ahead and held like any preparation, so the boundary is seamless.
    expect(checked).toEqual(["C:/private/media/gone.mkv"]);
    expectStandInArguments(spawner.spawnCalls[1]?.args);
    expect(logger.warns).toContainEqual({
      message: "signal_media_missing",
      context: {
        channelId: "channel-1",
        scheduleEntryId: "entry-2",
        mediaItemId: "media-2",
      },
    });
    standIn.writeStdout(packet(5));
    await flushMicrotasks(2);
    expect(forwarded).toEqual([]);
    preparation.commit();
    expect(Buffer.concat(forwarded)).toEqual(packet(5));
    const stopped = session.stop();
    first.exit({ code: null, signal: "SIGTERM" });
    standIn.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("starts FFmpeg anyway when the media check does not answer in time", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      // A stalled network mount never answers.
      isMediaPresent: () => new Promise<boolean>(() => undefined),
      ffmpegPath: "ffmpeg",
      spawner,
      timers,
      clock: timers,
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    first.writeStdout("usable-output");
    await session.ready;

    const preparing = trackSettlement(
      session.prepare(
        initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
      ),
    );
    await flushMicrotasks(2);
    expect(preparing.settled).toBe(false);
    timers.advanceBy(2_000);
    await flushMicrotasks(5);

    expect(preparing.settled).toBe(true);
    expect(spawner.spawnCalls[1]?.args).toContain("C:/private/media/movie.mkv");
    const stopped = session.stop();
    first.exit({ code: null, signal: "SIGTERM" });
    second.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });

  it("rejects a preparation that stop overtook during its media check", async () => {
    const { child, packager, spawner } = createHarness();
    const session = packager.start(initialItem());
    child.writeStdout("usable-output");
    await session.ready;

    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    const stopped = session.stop();
    child.exit({ code: null, signal: "SIGTERM" });

    await expectSignalError(preparing, "packaging_stopped");
    await stopped;
    expect(spawner.spawnCalls).toHaveLength(1);
  });

  it("ignores the readiness timeout of an item a later commit already replaced", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const third = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    spawner.enqueue(third);
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers,
      clock: timers,
      logger: new RecordingLogger(),
      itemReadinessTimeoutMs: 25,
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    session.output.resume();
    first.writeStdout("usable-output");
    await session.ready;
    // A short item committed before it said anything, then replaced at once.
    (
      await session.prepare(
        initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
      )
    ).commit();
    const next = await session.prepare(
      initialItem({ scheduleEntryId: "entry-3", mediaItemId: "media-3" }),
    );
    third.writeStdout("usable-output");
    next.commit();
    const completed = trackSettlement(session.completion);

    timers.advanceBy(25);
    await flushMicrotasks(2);

    expect(spawner.spawnCalls).toHaveLength(3);
    expect(completed.settled).toBe(false);
    const stopped = session.stop();
    for (const child of [first, second, third]) {
      child.exit({ code: null, signal: "SIGTERM" });
    }
    await stopped;
  });

  it("stops every FFmpeg process retained across a committed transition before settling", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
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
    const preparation = await preparing;
    second.writeStdout("usable-output");
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

  it("replaces a committed process that fails mid-item with a stand-in until the next commit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const standIn = new FakeProcess();
    const third = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    spawner.enqueue(first);
    spawner.enqueue(second);
    spawner.enqueue(standIn);
    spawner.enqueue(third);
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers: new FakeClock(),
      clock: new FakeClock(),
      logger: new RecordingLogger(),
      createReadinessInspector: () => new MarkerReadinessInspector(),
    });
    const session = packager.start(initialItem());
    const forwarded: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => forwarded.push(chunk));
    const preparing = session.prepare(
      initialItem({ scheduleEntryId: "entry-2", mediaItemId: "media-2" }),
    );
    const preparation = await preparing;
    second.writeStdout("usable-output");
    preparation.commit();
    first.exit({ code: null, signal: "SIGTERM" });
    const completed = trackSettlement(session.completion);

    second.exit({ code: 1, signal: null });
    await second.exited;
    await flushMicrotasks(2);

    // The offline card for at most the failed item's whole airtime; the
    // next commit truncates it.
    const standInArgs = spawner.spawnCalls[2]?.args;
    expectStandInArguments(standInArgs);
    expect(standInArgs?.[standInArgs.indexOf("-t") + 1]).toBe("30.000");
    standIn.writeStdout(packet(4));
    await flushMicrotasks(2);
    expect(Buffer.concat(forwarded).subarray(-188)).toEqual(packet(4));
    expect(session.output.readableEnded).toBe(false);
    expect(completed.settled).toBe(false);

    const next = await session.prepare(
      initialItem({ scheduleEntryId: "entry-3", mediaItemId: "media-3" }),
    );
    third.writeStdout("usable-output");
    next.commit();
    expect(standIn.terminationSignals).toEqual(["SIGTERM"]);
    standIn.exit({ code: null, signal: "SIGTERM" });
    await flushMicrotasks(2);
    expect(completed.settled).toBe(false);
    const stopped = session.stop();
    third.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });
  it("stops a prepared process that produces no usable output in time and airs a stand-in at its commit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const standIn = new FakeProcess();
    spawner.enqueue(standIn);
    const logger = new RecordingLogger();
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers,
      clock: timers,
      logger,
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
    // reaches the output, and the commit that would have aired it airs a
    // stand-in instead.
    expect(second.terminationSignals).toEqual(["SIGTERM"]);
    expect(second.stdout.listenerCount("data")).toBe(0);
    expect(completed.settled).toBe(false);
    const bytesAtFailure = Buffer.concat(forwarded);
    second.writeStdout(packet(7));
    await flushMicrotasks(2);
    expect(Buffer.concat(forwarded)).toEqual(bytesAtFailure);
    expect(outputError).not.toHaveBeenCalled();
    second.exit({ code: null, signal: "SIGTERM" });
    preparation.commit();

    expectStandInArguments(spawner.spawnCalls[2]?.args);
    expect(logger.warns).toContainEqual(
      expect.objectContaining({
        context: expect.objectContaining({ reason: "item_readiness_timeout" }),
      }),
    );
    expect(completed.settled).toBe(false);
    const stopped = session.stop();
    first.exit({ code: null, signal: "SIGTERM" });
    standIn.exit({ code: null, signal: "SIGTERM" });
    await stopped;
  });
  it("cancels each prepared FFmpeg process readiness timeout on usable output", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawner = new FakeProcessSpawner();
    const timers = new FakeClock();
    spawner.enqueue(first);
    spawner.enqueue(second);
    const packager = new FfmpegSignalPackager({
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers,
      clock: timers,
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
    const preparation = await preparing;
    second.writeStdout("usable-output");
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
      isMediaPresent: presentMedia,
      ffmpegPath: "ffmpeg",
      spawner,
      timers,
      clock: timers,
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
    const preparation = await preparing;
    second.writeStdout("usable-output");
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
    const { child, packager, spawner } = createHarness();
    const session = packager.start(initialItem());
    const ready = expectSignalError(session.ready, "packaging_stopped");

    const stopped = session.stop();
    expect(child.terminationSignals).toEqual(["SIGTERM"]);
    child.exit({ code: null, signal: "SIGTERM" });

    await ready;
    await expect(stopped).resolves.toBeUndefined();
    // An exit during stop() is not an item failure, so no stand-in starts.
    expect(spawner.spawnCalls).toHaveLength(1);
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
