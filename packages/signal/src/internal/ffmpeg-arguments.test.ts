import { describe, expect, it } from "vitest";

import type { SignalPlayoutItem } from "../contracts.js";
import { SignalError } from "../errors.js";
import { buildFfmpegArguments } from "./ffmpeg-arguments.js";

const item = (
  overrides: Partial<SignalPlayoutItem> = {},
): SignalPlayoutItem => ({
  channelId: "channel-1",
  scheduleEntryId: "entry-1",
  mediaItemId: "media-1",
  mediaPath: "C:/media/My Movie.mkv",
  mediaOffsetMs: 12_345,
  playDurationMs: 67_890,
  ...overrides,
});

describe("buildFfmpegArguments", () => {
  it("builds the paced fixed-profile MPEG-TS command", () => {
    expect(buildFfmpegArguments(item())).toEqual([
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "warning",
      "-re",
      "-ss",
      "12.345",
      "-i",
      "C:/media/My Movie.mkv",
      "-t",
      "67.890",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "mpegts",
      "pipe:1",
    ]);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid media offset %s before process creation",
    (mediaOffsetMs) => {
      expect(() => buildFfmpegArguments(item({ mediaOffsetMs }))).toThrowError(
        expect.objectContaining<Partial<SignalError>>({
          code: "invalid_playout_item",
          details: { field: "mediaOffsetMs" },
        }),
      );
    },
  );

  it.each([NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid play duration %s before process creation",
    (playDurationMs) => {
      expect(() => buildFfmpegArguments(item({ playDurationMs }))).toThrowError(
        expect.objectContaining<Partial<SignalError>>({
          code: "invalid_playout_item",
          details: { field: "playDurationMs" },
        }),
      );
    },
  );
});
