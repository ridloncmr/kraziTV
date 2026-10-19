import { describe, expect, it } from "vitest";

import {
  createFfmpegSignalPackager,
  defaultFillerFontFile,
  SystemRuntime,
} from "../src/index.js";
import { ffmpegPath, runFfmpeg, silentLogger, wait } from "./real-ffmpeg.js";

// The font production would use: FFMPEG_FONT_FILE, else the platform default.
const fontFile =
  process.env.FFMPEG_FONT_FILE ||
  defaultFillerFontFile(process.platform, process.env.WINDIR);
const AIRTIME_MS = 3_000;

describe("real FFmpeg filler", () => {
  it("emits black 1920x1080 video with its message over silent stereo for exactly its airtime", async () => {
    runFfmpeg(["-version"], "FFmpeg is required for test:ffmpeg");
    const packager = createFfmpegSignalPackager({
      ffmpegPath,
      logger: silentLogger,
      timers: new SystemRuntime(),
      terminationGraceMs: 5_000,
      itemReadinessTimeoutMs: 15_000,
      fillerFontFile: fontFile,
    });
    const startedAt = performance.now();
    const session = packager.start({
      kind: "filler",
      channelId: "69",
      // Characters the filter syntax would otherwise read as its own.
      message: "Programming resumes at 8:00 PM, [it's 100%]; ok",
      airtimeMs: AIRTIME_MS,
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

    // Paced to wall-clock time: unpaced generated input would burst out.
    const emittedMs = lastArrival - startedAt;
    expect(emittedMs).toBeGreaterThan(AIRTIME_MS - 500);
    expect(emittedMs).toBeLessThan(AIRTIME_MS + 1_500);

    const analysis = runFfmpeg(
      [
        ...["-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0"],
        ...["-vf", "signalstats,metadata=print"],
        ...["-af", "silencedetect=d=1", "-f", "null", "-"],
      ],
      "FFmpeg could not decode the filler capture",
      Buffer.concat(chunks),
    );
    expect(analysis).toMatch(/Video: h264[^\n]*1920x1080/);
    expect(analysis).toMatch(/Audio: aac[^\n]*48000 Hz, stereo/);
    // The whole item is silent.
    expect(analysis).toMatch(/silence_start: ?-?0(\.0+)?\b/);
    const brightest = [...analysis.matchAll(/signalstats\.YMAX=(\d+)/g)].map(
      (match) => Number(match[1]),
    );
    const averages = [...analysis.matchAll(/signalstats\.YAVG=([\d.]+)/g)].map(
      (match) => Number(match[1]),
    );
    // Thirty frames a second for the airtime, give or take encoder edges.
    expect(brightest.length).toBeGreaterThan((AIRTIME_MS / 1_000) * 30 - 10);
    expect(brightest.length).toBeLessThan((AIRTIME_MS / 1_000) * 30 + 10);
    // Mostly black, but white text pixels on every frame.
    expect(Math.max(...averages)).toBeLessThan(40);
    expect(Math.min(...brightest)).toBeGreaterThan(200);
  }, 45_000);
});
