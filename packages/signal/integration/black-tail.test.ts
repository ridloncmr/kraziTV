import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFfmpegSignalPackager, SystemRuntime } from "../src/index.js";

const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const MEDIA_MS = 2_000;
const BLACK_TAIL_MS = 3_000;
const AIRTIME_MS = MEDIA_MS + BLACK_TAIL_MS;

const AUDIO_ONLY_MS = 3_000;

let fixtureDirectory: string;
const clipPaths = new Map<boolean, string>();
let coverArtPath: string;

beforeAll(async () => {
  runFfmpeg(["-version"], "FFmpeg is required for test:ffmpeg");
  fixtureDirectory = await mkdtemp(join(tmpdir(), "krazitv-black-tail-"));
  // A bright test pattern, so black can only come from the black tail. The
  // toned clip proves silence does too; the silent one exercises the
  // synthesized-silence input.
  const tonedPath = join(fixtureDirectory, "pattern-and-tone.mkv");
  runFfmpeg(
    [
      ...["-y", "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=2"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=2"],
      ...["-c:v", "libx264", "-c:a", "aac", tonedPath],
    ],
    "FFmpeg could not generate the toned black-tail fixture",
  );
  const silentPath = join(fixtureDirectory, "pattern-only.mkv");
  runFfmpeg(
    [
      ...["-y", "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=2"],
      ...["-c:v", "libx264", silentPath],
    ],
    "FFmpeg could not generate the silent black-tail fixture",
  );
  clipPaths.set(true, tonedPath).set(false, silentPath);
  // Audio whose only picture is cover art: mapping that picture would freeze
  // one frame, so packaging must render black instead.
  coverArtPath = join(fixtureDirectory, "tone-with-cover.mp4");
  runFfmpeg(
    [
      ...[
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:d=3",
      ],
      ...["-f", "lavfi", "-i", "testsrc=s=320x240:r=25:d=0.04"],
      ...["-map", "0:a:0", "-map", "1:v:0", "-c:a", "aac", "-c:v", "mjpeg"],
      ...["-disposition:v:0", "attached_pic", coverArtPath],
    ],
    "FFmpeg could not generate the cover-art fixture",
  );
});

afterAll(async () => {
  if (fixtureDirectory !== undefined) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

describe("real FFmpeg black tail", () => {
  it.each([
    { hasAudio: true, audio: "source audio" },
    { hasAudio: false, audio: "synthesized silence" },
  ])(
    "emits the full airtime at wall-clock pace after short media with $audio",
    async ({ hasAudio }) => {
      const packager = createFfmpegSignalPackager({
        ffmpegPath,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        timers: new SystemRuntime(),
        terminationGraceMs: 5_000,
        itemReadinessTimeoutMs: 15_000,
      });
      const startedAt = performance.now();
      const session = packager.start({
        channelId: "69",
        scheduleEntryId: "entry-short",
        mediaItemId: "media-short",
        mediaPath: clipPaths.get(hasAudio) ?? "",
        hasAudio,
        hasVideo: true,
        mediaOffsetMs: 0,
        playDurationMs: MEDIA_MS,
        blackTailMs: BLACK_TAIL_MS,
      });
      const chunks: Buffer[] = [];
      let lastArrival = startedAt;
      session.output.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        lastArrival = performance.now();
      });

      await session.ready;
      await wait(AIRTIME_MS + 2_000);
      await session.stop();

      // Measured from spawn, because encoder lookahead delays the first chunk.
      // Unpaced, the tail bursts out and output ends about when the media does;
      // over-paced, the broadcast falls behind the schedule.
      const emittedMs = lastArrival - startedAt;
      expect(emittedMs).toBeGreaterThan(AIRTIME_MS - 500);
      expect(emittedMs).toBeLessThan(AIRTIME_MS + 1_500);

      const analysis = runFfmpeg(
        [
          ...["-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0"],
          ...["-vf", "blackdetect=d=1:pix_th=0.05"],
          ...["-af", "silencedetect=d=1", "-f", "null", "-"],
        ],
        "FFmpeg could not decode the black-tail capture",
        Buffer.concat(chunks),
      );
      const black = /black_start:([\d.]+) black_end:([\d.]+)/.exec(analysis);
      expect(black, analysis).not.toBeNull();
      const [blackStart, blackEnd] = [Number(black?.[1]), Number(black?.[2])];
      expect(blackStart).toBeCloseTo(MEDIA_MS / 1_000, 0);
      expect(blackEnd - blackStart).toBeGreaterThan(
        BLACK_TAIL_MS / 1_000 - 0.5,
      );
      expect(analysis).toMatch(/silence_start: ?([\d.]+)/);
    },
    45_000,
  );
});

describe("real FFmpeg black video", () => {
  it("emits audio-only media over black video at wall-clock pace", async () => {
    const packager = createFfmpegSignalPackager({
      ffmpegPath,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      timers: new SystemRuntime(),
      terminationGraceMs: 5_000,
      itemReadinessTimeoutMs: 15_000,
    });
    const startedAt = performance.now();
    const session = packager.start({
      channelId: "69",
      scheduleEntryId: "entry-audio-only",
      mediaItemId: "media-audio-only",
      mediaPath: coverArtPath,
      hasAudio: true,
      hasVideo: false,
      mediaOffsetMs: 0,
      playDurationMs: AUDIO_ONLY_MS,
      blackTailMs: 0,
    });
    const chunks: Buffer[] = [];
    let lastArrival = startedAt;
    session.output.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      lastArrival = performance.now();
    });

    await session.ready;
    await wait(AUDIO_ONLY_MS + 2_000);
    await session.stop();

    // Generated video is unpaced on its own; the paced audio must hold it.
    const emittedMs = lastArrival - startedAt;
    expect(emittedMs).toBeGreaterThan(AUDIO_ONLY_MS - 500);
    expect(emittedMs).toBeLessThan(AUDIO_ONLY_MS + 1_500);

    const analysis = runFfmpeg(
      [
        ...["-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0"],
        ...["-vf", "blackdetect=d=1:pix_th=0.05"],
        ...["-af", "silencedetect=d=1", "-f", "null", "-"],
      ],
      "FFmpeg could not decode the audio-only capture",
      Buffer.concat(chunks),
    );
    const black = /black_start:([\d.]+) black_end:([\d.]+)/.exec(analysis);
    expect(black, analysis).not.toBeNull();
    const [blackStart, blackEnd] = [Number(black?.[1]), Number(black?.[2])];
    expect(blackStart).toBeLessThan(0.5);
    expect(blackEnd - blackStart).toBeGreaterThan(AUDIO_ONLY_MS / 1_000 - 0.5);
    // The tone plays throughout, so no second of silence is detected.
    expect(analysis).not.toMatch(/silence_start/);
  }, 45_000);
});

/**
 * Runs FFmpeg to completion and returns its stderr, where FFmpeg writes its
 * filter reports. Fails the suite rather than skipping when FFmpeg is missing.
 */
function runFfmpeg(
  args: readonly string[],
  failure: string,
  input?: Buffer,
): string {
  const result = spawnSync(
    ffmpegPath,
    // The capture arrives on stdin, so `-nostdin` is never passed here.
    args[0] === "-version" ? args : ["-hide_banner", ...args],
    {
      input,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `${failure} ("${ffmpegPath}"). Install FFmpeg or set FFMPEG_PATH: ${result.stderr?.trim() || result.error?.message}`,
      { cause: result.error },
    );
  }
  return result.stderr;
}

/** Lets the real broadcast run for a fixed wall-clock span. */
function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}
