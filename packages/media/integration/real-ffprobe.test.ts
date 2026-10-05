import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMediaProber } from "../src/index.js";

const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";

let fixtureDirectory: string;
let toneClipPath: string;
let silentClipPath: string;
let coverArtClipPath: string;

beforeAll(async () => {
  requireExecutable("ffmpeg", ffmpegPath, "FFMPEG_PATH");
  requireExecutable("ffprobe", ffprobePath, "FFPROBE_PATH");
  fixtureDirectory = await mkdtemp(join(tmpdir(), "krazitv-ffprobe-"));

  // MOV keeps each stream's native timescale, so ffprobe reports exact sample
  // and frame counts: 120024 PCM samples at 48 kHz outlast the 2 s video and
  // make the format duration exactly 2.500500 s. Both sources are bounded at
  // the input because an output frame limit would also cut the audio short.
  toneClipPath = join(fixtureDirectory, "color-and-tone.mov");
  generateClip([
    ...["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=25:d=2"],
    ...[
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=2.5005",
    ],
    ...["-map", "0:v:0", "-map", "1:a:0"],
    ...["-c:v", "mpeg4", "-c:a", "pcm_s16le", toneClipPath],
  ]);

  // 75 frames at 30000/1001 fps last exactly 75075/30000 = 2.502500 s.
  silentClipPath = join(fixtureDirectory, "color-only.mov");
  generateClip([
    ...["-f", "lavfi", "-i", "color=c=red:s=64x64:r=30000/1001"],
    ...["-frames:v", "75", "-c:v", "mpeg4", silentClipPath],
  ]);

  // An audio file whose only picture is one frame of cover art. MP4 marks it
  // with the attached_pic disposition; Matroska would store an attachment.
  coverArtClipPath = join(fixtureDirectory, "tone-with-cover.mp4");
  generateClip([
    ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"],
    ...["-f", "lavfi", "-i", "color=c=red:s=64x64:r=25:d=0.04"],
    ...["-map", "0:a:0", "-map", "1:v:0", "-c:a", "aac", "-c:v", "mjpeg"],
    ...["-disposition:v:0", "attached_pic", coverArtClipPath],
  ]);
  // Four cold process launches can be slow while Windows Defender scans them.
}, 30_000);

afterAll(async () => {
  if (fixtureDirectory) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

// Leaves headroom above the prober's 10 s limit so a slow ffprobe reports timed_out.
const TEST_TIMEOUT_MS = 20_000;

describe(
  "createMediaProber against real ffprobe",
  { timeout: TEST_TIMEOUT_MS },
  () => {
    const prober = () => createMediaProber({ ffprobePath, timeoutMs: 10_000 });

    it("rounds a half-millisecond duration up and detects audio", async () => {
      await expect(prober().probe(toneClipPath)).resolves.toEqual({
        durationMs: 2_501,
        hasAudio: true,
        hasVideo: true,
      });
    });

    it("rounds a video-only duration and reports no audio", async () => {
      await expect(prober().probe(silentClipPath)).resolves.toEqual({
        durationMs: 2_503,
        hasAudio: false,
        hasVideo: true,
      });
    });

    it("reports no video for audio whose only picture is cover art", async () => {
      const result = await prober().probe(coverArtClipPath);

      expect(result).toMatchObject({ hasAudio: true, hasVideo: false });
      // AAC framing can shift the container duration by a few milliseconds.
      expect(Math.abs(result.durationMs - 2_000)).toBeLessThan(50);
    });
  },
);

/**
 * Fails loudly when a tool is missing: running this suite is the explicit
 * opt-in, so a silent skip would hide an unverified real-ffprobe gate.
 */
function requireExecutable(name: string, path: string, envName: string): void {
  const result = spawnSync(path, ["-version"], {
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${name} is required for test:ffprobe but "${path}" could not run. Install FFmpeg or set ${envName} to its executable.`,
      { cause: result.error },
    );
  }
}

/** Writes one controlled fixture with FFmpeg, surfacing its stderr on failure. */
function generateClip(args: readonly string[]): void {
  const result = spawnSync(
    ffmpegPath,
    ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args],
    { encoding: "utf8", shell: false, windowsHide: true },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `FFmpeg could not generate a probe fixture: ${result.stderr?.trim() || result.error?.message}`,
      { cause: result.error },
    );
  }
}
