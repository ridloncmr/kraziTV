import { describe, expect, it } from "vitest";

import { parseFfmpegFontFile, parseFfmpegPath } from "./ffmpeg.js";

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

describe("parseFfmpegFontFile", () => {
  it("accepts a configured font file", () => {
    expect(
      parseFfmpegFontFile({ FFMPEG_FONT_FILE: " /fonts/a.ttf " }, "win32"),
    ).toBe("/fonts/a.ttf");
  });

  it("defaults to Arial in the Windows directory on Windows", () => {
    expect(parseFfmpegFontFile({ WINDIR: "D:\\WINDOWS" }, "win32")).toBe(
      "D:/WINDOWS/Fonts/arial.ttf",
    );
  });

  it("leaves other platforms to fontconfig", () => {
    expect(parseFfmpegFontFile({ FFMPEG_FONT_FILE: " " }, "linux")).toBe(
      undefined,
    );
  });
});
