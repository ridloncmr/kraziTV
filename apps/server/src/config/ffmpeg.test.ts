import { describe, expect, it } from "vitest";

import { parseFfmpegPath } from "./ffmpeg.js";

describe("parseFfmpegPath", () => {
  it("defaults to ffmpeg on PATH", () => {
    expect(parseFfmpegPath({})).toBe("ffmpeg");
  });

  it("accepts a configured path", () => {
    expect(parseFfmpegPath({ FFMPEG_PATH: " /opt/ffmpeg/bin/ffmpeg " })).toBe(
      "/opt/ffmpeg/bin/ffmpeg",
    );
  });

  it("treats a blank value as unset", () => {
    expect(parseFfmpegPath({ FFMPEG_PATH: "  " })).toBe("ffmpeg");
  });
});
