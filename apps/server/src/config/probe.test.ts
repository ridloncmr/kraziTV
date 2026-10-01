import { describe, expect, it } from "vitest";

import { parseProbeConfig } from "./probe.js";

describe("parseProbeConfig", () => {
  it("defaults to ffprobe on PATH, a 30 second timeout, and 4 concurrent probes", () => {
    expect(parseProbeConfig({})).toEqual({
      ffprobePath: "ffprobe",
      timeoutMs: 30_000,
      concurrency: 4,
    });
  });

  it("accepts configured values", () => {
    expect(
      parseProbeConfig({
        FFPROBE_PATH: " /opt/ffmpeg/bin/ffprobe ",
        FFPROBE_TIMEOUT_MS: "5000",
        FFPROBE_CONCURRENCY: "32",
      }),
    ).toEqual({
      ffprobePath: "/opt/ffmpeg/bin/ffprobe",
      timeoutMs: 5_000,
      concurrency: 32,
    });
  });

  it("treats blank values as unset", () => {
    expect(
      parseProbeConfig({
        FFPROBE_PATH: "  ",
        FFPROBE_TIMEOUT_MS: "",
        FFPROBE_CONCURRENCY: " ",
      }),
    ).toEqual({ ffprobePath: "ffprobe", timeoutMs: 30_000, concurrency: 4 });
  });

  it.each(["0", "-1", "1.5", "abc", "1e3", "9007199254740992"])(
    "rejects FFPROBE_TIMEOUT_MS=%s",
    (value) => {
      expect(() => parseProbeConfig({ FFPROBE_TIMEOUT_MS: value })).toThrow(
        /FFPROBE_TIMEOUT_MS/,
      );
    },
  );

  it.each(["0", "33", "2.5", "four"])(
    "rejects FFPROBE_CONCURRENCY=%s",
    (value) => {
      expect(() => parseProbeConfig({ FFPROBE_CONCURRENCY: value })).toThrow(
        /FFPROBE_CONCURRENCY/,
      );
    },
  );
});
