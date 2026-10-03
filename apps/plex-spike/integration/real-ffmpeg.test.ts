import { spawnSync } from "node:child_process";

import {
  createFfmpegSignalPackager,
  type ScheduledTask,
  type SignalLogger,
  type SignalPlayoutItem,
  type TimerScheduler,
} from "@krazitv/signal";
import { beforeAll, describe, expect, it } from "vitest";

import {
  loadSpikeConfig,
  type SpikeConfig,
  verifySpikePrerequisites,
} from "../src/config.js";

const MPEG_TS_PACKET_BYTES = 188;

class NativeTimers implements TimerScheduler {
  /** Gives the real process lifecycle cancellable wall-clock deadlines. */
  setTimeout(callback: () => void, delayMs: number): ScheduledTask {
    let active = true;
    const handle = globalThis.setTimeout(() => {
      active = false;
      callback();
    }, delayMs);
    return {
      get active() {
        return active;
      },
      cancel: () => {
        if (!active) return;
        active = false;
        globalThis.clearTimeout(handle);
      },
    };
  }
}

class MeasurementLogger implements SignalLogger {
  private readonly waiters = new Map<string, Array<() => void>>();

  /** Ignores debug records outside the smoke assertion surface. */
  debug(): void {}

  /** Resolves event waiters while retaining human-readable smoke output. */
  info(message: string, context?: Readonly<Record<string, unknown>>): void {
    process.stdout.write(`${message} ${JSON.stringify(context ?? {})}\n`);
    for (const resolve of this.waiters.get(message) ?? []) resolve();
    this.waiters.delete(message);
  }

  /** Preserves warnings in explicit integration output. */
  warn(message: string, context?: Readonly<Record<string, unknown>>): void {
    process.stderr.write(`${message} ${JSON.stringify(context ?? {})}\n`);
  }

  /** Preserves normalized FFmpeg failures in explicit integration output. */
  error(message: string, context?: Readonly<Record<string, unknown>>): void {
    process.stderr.write(`${message} ${JSON.stringify(context ?? {})}\n`);
  }

  /** Waits for one retained lifecycle measurement with a hard wall-clock bound. */
  waitFor(message: string, timeoutMs = 15_000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = globalThis.setTimeout(
        () => reject(new Error(`Timed out waiting for ${message}`)),
        timeoutMs,
      );
      const finish = (): void => {
        globalThis.clearTimeout(timeout);
        resolve();
      };
      const existing = this.waiters.get(message) ?? [];
      existing.push(finish);
      this.waiters.set(message, existing);
    });
  }
}

let config: SpikeConfig;

beforeAll(async () => {
  config = loadSpikeConfig();
  await verifySpikePrerequisites(config);
});

describe("real FFmpeg signal baseline", () => {
  it("seeks, crosses one real file boundary, and leaves decodable fixed-profile MPEG-TS", async () => {
    const logger = new MeasurementLogger();
    const packager = createFfmpegSignalPackager({
      ffmpegPath: config.ffmpegPath,
      logger,
      timers: new NativeTimers(),
      terminationGraceMs: 5_000,
      itemReadinessTimeoutMs: 15_000,
    });
    const initial = item("entry-a", "media-a", config.mediaAPath, 1_000);
    const following = item("entry-b", "media-b", config.mediaBPath, 2_000);
    const session = packager.start(initial);
    const output: Buffer[] = [];
    session.output.on("data", (chunk: Buffer) => output.push(chunk));

    await session.ready;
    const committedReady = logger.waitFor("signal_committed_item_ready");
    const preparation = await session.prepare(following);
    const boundaryByteOffset = output.reduce(
      (total, chunk) => total + chunk.byteLength,
      0,
    );
    preparation.commit();
    await committedReady;
    await wait(1_000);
    await session.stop();

    const capture = Buffer.concat(output);
    expect(capture.byteLength).toBeGreaterThan(MPEG_TS_PACKET_BYTES * 100);
    expect(capture.byteLength % MPEG_TS_PACKET_BYTES).toBe(0);
    expect(transportPids(capture)).toEqual(
      expect.arrayContaining([0, 256, 257, 4096]),
    );

    expectDecode(config.ffmpegPath, capture);
    expectDecode(config.ffmpegPath, capture.subarray(boundaryByteOffset));
  }, 45_000);
});

/** Creates one known-audio item while exercising a non-zero seek. */
function item(
  scheduleEntryId: string,
  mediaItemId: string,
  mediaPath: string,
  mediaOffsetMs: number,
): SignalPlayoutItem {
  return {
    channelId: "69",
    scheduleEntryId,
    mediaItemId,
    mediaPath,
    hasAudio: true,
    mediaOffsetMs,
    playDurationMs: 5_000,
    blackTailMs: 0,
  };
}

/** Extracts distinct packet identifiers from one packet-aligned capture. */
function transportPids(capture: Buffer): number[] {
  const pids = new Set<number>();
  for (let offset = 0; offset < capture.byteLength; offset += 188) {
    expect(capture[offset]).toBe(0x47);
    pids.add(
      ((capture[offset + 1] ?? 0) & 0x1f) * 256 + (capture[offset + 2] ?? 0),
    );
  }
  return [...pids];
}

/** Proves both the whole splice and the newly committed segment initialize. */
function expectDecode(ffmpegPath: string, capture: Buffer): void {
  const decoded = spawnSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ],
    {
      input: capture,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  expect(decoded.error).toBeUndefined();
  expect(decoded.status, decoded.stderr).toBe(0);
}

/** Keeps the environment test explicit without coupling unit tests to real time. */
function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}
