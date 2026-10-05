import { describe, expect, it } from "vitest";

import { MediaProbeError } from "./media-probe-error.js";
import { parseFfprobeOutput } from "./parse-ffprobe-output.js";

// Builds ffprobe JSON shaped like
// `-show_entries format=duration:stream=codec_type:stream_disposition=attached_pic`.
function ffprobeJson(duration: unknown, codecTypes: string[] = ["video"]) {
  return JSON.stringify({
    streams: codecTypes.map((codec_type) => ({ codec_type })),
    format: duration === undefined ? {} : { duration },
  });
}

// Captures the typed error a parse failure must produce.
function parseError(stdout: string): MediaProbeError {
  try {
    parseFfprobeOutput(stdout);
  } catch (error) {
    expect(error).toBeInstanceOf(MediaProbeError);
    return error as MediaProbeError;
  }
  throw new Error("Expected parseFfprobeOutput to throw");
}

describe("parseFfprobeOutput", () => {
  it("converts fractional seconds to whole milliseconds", () => {
    expect(parseFfprobeOutput(ffprobeJson("1320.042000"))).toEqual({
      durationMs: 1_320_042,
      hasAudio: false,
      hasVideo: true,
    });
  });

  it("rounds sub-millisecond durations to the nearest millisecond", () => {
    expect(parseFfprobeOutput(ffprobeJson("10.0004")).durationMs).toBe(10_000);
    expect(parseFfprobeOutput(ffprobeJson("10.0005")).durationMs).toBe(10_001);
    expect(parseFfprobeOutput(ffprobeJson("10.0006")).durationMs).toBe(10_001);
  });

  it("rounds exact half milliseconds up without float drift", () => {
    // Float math turns 0.5005 * 1000 into 500.49999..., rounding down.
    expect(parseFfprobeOutput(ffprobeJson("0.500500")).durationMs).toBe(501);
    expect(parseFfprobeOutput(ffprobeJson("4999.999500")).durationMs).toBe(
      5_000_000,
    );
  });

  it("accepts whole-second durations", () => {
    expect(parseFfprobeOutput(ffprobeJson("42")).durationMs).toBe(42_000);
  });

  it("detects audio from any audio stream", () => {
    const stdout = ffprobeJson("5", ["video", "subtitle", "audio"]);
    expect(parseFfprobeOutput(stdout).hasAudio).toBe(true);
  });

  it("reports no audio when the stream list has none or is absent", () => {
    expect(parseFfprobeOutput(ffprobeJson("5", ["video"])).hasAudio).toBe(
      false,
    );
    const noStreams = JSON.stringify({ format: { duration: "5" } });
    expect(parseFfprobeOutput(noStreams).hasAudio).toBe(false);
  });

  it("reports no video for audio-only media", () => {
    expect(parseFfprobeOutput(ffprobeJson("5", ["audio"])).hasVideo).toBe(
      false,
    );
    const noStreams = JSON.stringify({ format: { duration: "5" } });
    expect(parseFfprobeOutput(noStreams).hasVideo).toBe(false);
  });

  // Audio files carry cover art as a one-frame video stream; packaging it
  // would freeze the picture instead of showing black.
  it("ignores attached cover art when detecting video", () => {
    const coverArtOnly = JSON.stringify({
      streams: [
        { codec_type: "audio", disposition: { attached_pic: 0 } },
        { codec_type: "video", disposition: { attached_pic: 1 } },
      ],
      format: { duration: "5" },
    });
    expect(parseFfprobeOutput(coverArtOnly).hasVideo).toBe(false);

    const realVideo = JSON.stringify({
      streams: [{ codec_type: "video", disposition: { attached_pic: 0 } }],
      format: { duration: "5" },
    });
    expect(parseFfprobeOutput(realVideo).hasVideo).toBe(true);
  });

  it("exposes only normalized fields, never raw ffprobe JSON", () => {
    const stdout = JSON.stringify({
      streams: [{ codec_type: "audio", codec_name: "aac" }],
      format: { duration: "5", format_name: "matroska" },
    });
    expect(Object.keys(parseFfprobeOutput(stdout)).sort()).toEqual([
      "durationMs",
      "hasAudio",
      "hasVideo",
    ]);
  });

  it("rejects malformed JSON", () => {
    expect(parseError("{not json").code).toBe("invalid_json");
    expect(parseError("").code).toBe("invalid_json");
  });

  it.each([
    ["a non-object document", "[]"],
    ["a missing format section", JSON.stringify({ streams: [] })],
    ["a missing duration", ffprobeJson(undefined)],
    ["a non-numeric duration", ffprobeJson("N/A")],
    ["an empty duration", ffprobeJson("")],
    ["a zero duration", ffprobeJson("0.000000")],
    ["a negative duration", ffprobeJson("-3.5")],
    ["a duration that rounds to zero", ffprobeJson("0.0004")],
    ["a non-finite duration", ffprobeJson("Infinity")],
    ["an exponent-notation duration", ffprobeJson("1e3")],
    ["a numeric rather than decimal-string duration", ffprobeJson(5)],
    ["an unsafe-integer duration", ffprobeJson("9007199254740.992")],
    [
      "a non-array stream list",
      JSON.stringify({ streams: {}, format: { duration: "5" } }),
    ],
  ])("rejects %s as invalid metadata", (_case, stdout) => {
    expect(parseError(stdout).code).toBe("invalid_metadata");
  });
});
