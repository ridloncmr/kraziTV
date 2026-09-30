import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildTestAssetArguments,
  defaultTestAssetDirectory,
  generateTestAssets,
} from "./test-assets.js";

describe("buildTestAssetArguments", () => {
  it("builds deterministic VIDEO A with a visible timecode and distinct tone", () => {
    const args = buildTestAssetArguments({
      label: "VIDEO A",
      color: "blue",
      toneHz: 440,
      durationSeconds: 30,
      outputPath: "data/signal-spike/video-a.mp4",
      fontPath: "C:\\Windows\\Fonts\\arial.ttf",
    });

    expect(args).toContain("color=c=blue:s=1280x720:r=30:d=30");
    expect(args).toContain("sine=frequency=440:sample_rate=48000:duration=30");
    expect(args.join(" ")).toContain("VIDEO A");
    expect(args.join(" ")).toContain("%{pts\\:hms}");
    expect(args.join(" ")).toContain("fontfile='C\\:/Windows/Fonts/arial.ttf'");
    expect(args.slice(-1)).toEqual(["data/signal-spike/video-a.mp4"]);
    expect(args).toContain("-y");
  });

  it("changes both the visual identity and audio tone for VIDEO B", () => {
    const args = buildTestAssetArguments({
      label: "VIDEO B",
      color: "red",
      toneHz: 660,
      durationSeconds: 30,
      outputPath: "data/signal-spike/video-b.mp4",
    });

    expect(args).toContain("color=c=red:s=1280x720:r=30:d=30");
    expect(args).toContain("sine=frequency=660:sample_rate=48000:duration=30");
    expect(args.join(" ")).toContain("VIDEO B");
  });

  it("defaults generated assets to the repository-level ignored data directory", () => {
    expect(defaultTestAssetDirectory()).toBe(
      resolve(process.cwd(), "../../data/signal-spike"),
    );
  });

  it("turns a missing FFmpeg executable into an actionable generation error", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    });

    await expect(
      generateTestAssets(
        "C:/missing/ffmpeg.exe",
        [
          {
            label: "VIDEO A",
            color: "blue",
            toneHz: 440,
            durationSeconds: 30,
            outputPath: "data/signal-spike/video-a.mp4",
          },
        ],
        run,
      ),
    ).rejects.toThrow(
      /C:\/missing\/ffmpeg\.exe.*Install FFmpeg or set KRAZITV_SPIKE_FFMPEG_PATH/i,
    );
  });
});
