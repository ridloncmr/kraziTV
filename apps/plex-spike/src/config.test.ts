import { describe, expect, it, vi } from "vitest";

import {
  loadSpikeConfig,
  verifySpikePrerequisites,
  type SpikeConfig,
} from "./config.js";

const validConfig: SpikeConfig = {
  ffmpegPath: "C:/tools/ffmpeg.exe",
  mediaAPath: "C:/spike/video-a.mp4",
  mediaBPath: "C:/spike/video-b.mp4",
  mediaDurationMs: 30_000,
  airtimeMs: 30_000,
  publicBaseUrl: "http://10.0.0.25:3100",
  host: "0.0.0.0",
  port: 3100,
};

describe("loadSpikeConfig", () => {
  it("loads explicit network, media, duration, and FFmpeg configuration", () => {
    expect(
      loadSpikeConfig({
        KRAZITV_SPIKE_FFMPEG_PATH: "C:/tools/ffmpeg.exe",
        KRAZITV_SPIKE_MEDIA_A_PATH: "C:/media/a.mp4",
        KRAZITV_SPIKE_MEDIA_B_PATH: "C:/media/b.mp4",
        KRAZITV_SPIKE_PUBLIC_BASE_URL: "http://spike.local:4000/",
        KRAZITV_SPIKE_HOST: "0.0.0.0",
        KRAZITV_SPIKE_PORT: "4000",
      }),
    ).toEqual({
      ffmpegPath: "C:/tools/ffmpeg.exe",
      mediaAPath: "C:/media/a.mp4",
      mediaBPath: "C:/media/b.mp4",
      mediaDurationMs: 30_000,
      airtimeMs: 30_000,
      publicBaseUrl: "http://spike.local:4000",
      host: "0.0.0.0",
      port: 4000,
    });
  });

  it("lengthens each slot past its media so boundaries cross a black tail", () => {
    const config = loadSpikeConfig({
      KRAZITV_SPIKE_MEDIA_A_PATH: "a.mp4",
      KRAZITV_SPIKE_MEDIA_B_PATH: "b.mp4",
      KRAZITV_SPIKE_AIRTIME_MS: "40000",
    });

    expect(config).toMatchObject({
      mediaDurationMs: 30_000,
      airtimeMs: 40_000,
    });
  });

  it("rejects an airtime that would cut the media short", () => {
    expect(() =>
      loadSpikeConfig({
        KRAZITV_SPIKE_MEDIA_A_PATH: "a.mp4",
        KRAZITV_SPIKE_MEDIA_B_PATH: "b.mp4",
        KRAZITV_SPIKE_AIRTIME_MS: "20000",
      }),
    ).toThrowError(/KRAZITV_SPIKE_AIRTIME_MS must be at least 30000/);
  });

  it("points missing assets at the deterministic generation command", () => {
    expect(() => loadSpikeConfig({})).toThrowError(
      /KRAZITV_SPIKE_MEDIA_A_PATH.*npm run assets --workspace @krazitv\/plex-spike/s,
    );
  });

  it("rejects an invalid public URL before startup", () => {
    expect(() =>
      loadSpikeConfig({
        KRAZITV_SPIKE_MEDIA_A_PATH: "a.mp4",
        KRAZITV_SPIKE_MEDIA_B_PATH: "b.mp4",
        KRAZITV_SPIKE_PUBLIC_BASE_URL: "not-a-url",
      }),
    ).toThrowError(
      /KRAZITV_SPIKE_PUBLIC_BASE_URL must be an absolute HTTP URL/,
    );
  });

  it("rejects a public URL path that does not match the root-mounted routes", () => {
    expect(() =>
      loadSpikeConfig({
        KRAZITV_SPIKE_MEDIA_A_PATH: "a.mp4",
        KRAZITV_SPIKE_MEDIA_B_PATH: "b.mp4",
        KRAZITV_SPIKE_PUBLIC_BASE_URL: "http://spike.local:3000/base",
      }),
    ).toThrowError(/must not contain a path, query, or fragment/);
  });
});

describe("verifySpikePrerequisites", () => {
  it("checks both assets and records the configured FFmpeg version", async () => {
    const accessFile = vi.fn(async () => undefined);
    const inspectFfmpeg = vi.fn(() => "ffmpeg version 8.0");
    const identifyAsset = vi
      .fn<(path: string) => Promise<string>>()
      .mockResolvedValueOnce("hash-a")
      .mockResolvedValueOnce("hash-b");

    const result = await verifySpikePrerequisites(validConfig, {
      accessFile,
      inspectFfmpeg,
      identifyAsset,
    });

    expect(accessFile).toHaveBeenCalledTimes(2);
    expect(accessFile).toHaveBeenNthCalledWith(1, validConfig.mediaAPath);
    expect(accessFile).toHaveBeenNthCalledWith(2, validConfig.mediaBPath);
    expect(inspectFfmpeg).toHaveBeenCalledWith(validConfig.ffmpegPath);
    expect(result).toEqual({
      ffmpegVersion: "ffmpeg version 8.0",
      assets: [
        { path: validConfig.mediaAPath, sha256: "hash-a" },
        { path: validConfig.mediaBPath, sha256: "hash-b" },
      ],
    });
  });

  it("reports the missing asset and the generation command", async () => {
    await expect(
      verifySpikePrerequisites(validConfig, {
        accessFile: vi.fn(async (path) => {
          if (path === validConfig.mediaBPath) throw new Error("ENOENT");
        }),
        inspectFfmpeg: vi.fn(() => "ffmpeg version 8.0"),
      }),
    ).rejects.toThrowError(/video-b\.mp4.*npm run assets/s);
  });

  it("reports how to configure an unavailable FFmpeg executable", async () => {
    await expect(
      verifySpikePrerequisites(validConfig, {
        accessFile: vi.fn(async () => undefined),
        inspectFfmpeg: vi.fn(() => {
          throw new Error("ENOENT");
        }),
      }),
    ).rejects.toThrowError(
      /KRAZITV_SPIKE_FFMPEG_PATH.*C:\/tools\/ffmpeg\.exe/s,
    );
  });
});
