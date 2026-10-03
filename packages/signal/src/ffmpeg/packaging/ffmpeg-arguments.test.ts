import { describe, expect, it } from "vitest";

import { SignalError } from "../../errors.js";
import type { SignalPlayoutItem } from "../../signal-packager/contracts.js";
import { buildFfmpegArguments } from "./ffmpeg-arguments.js";

const item = (
  overrides: Partial<SignalPlayoutItem> = {},
): SignalPlayoutItem => ({
  channelId: "channel-1",
  scheduleEntryId: "entry-1",
  mediaItemId: "media-1",
  mediaPath: "C:/media/My Movie.mkv",
  hasAudio: true,
  mediaOffsetMs: 12_345,
  playDurationMs: 67_890,
  blackTailMs: 0,
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
      "0:a:0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-g",
      "30",
      "-keyint_min",
      "30",
      "-sc_threshold",
      "0",
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-streamid",
      "0:256",
      "-streamid",
      "1:257",
      "-mpegts_start_pid",
      "256",
      "-mpegts_pmt_start_pid",
      "4096",
      "-f",
      "mpegts",
      "pipe:1",
    ]);
  });

  it("synthesizes one stereo audio stream for silent media at the stable audio PID", () => {
    const args = buildFfmpegArguments(item({ hasAudio: false }));

    expect(args).toEqual(
      expect.arrayContaining([
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-map",
        "1:a:0",
        "-streamid",
        "1:257",
      ]),
    );
    expect(args).not.toContain("0:a:0?");
  });

  it("reads only the media span and extends the output with a black tail", () => {
    const args = buildFfmpegArguments(
      item({ playDurationMs: 4_000, blackTailMs: 6_500 }),
    );

    expect(args.slice(4, 11)).toEqual([
      "-re",
      "-ss",
      "12.345",
      "-t",
      "4.000",
      "-i",
      "C:/media/My Movie.mkv",
    ]);
    expect(args).toEqual(expect.arrayContaining(["-t", "10.500"]));
    expect(args[args.indexOf("-vf") + 1]).toBe(
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1," +
        "tpad=stop_mode=add:stop=-1:color=black",
    );
    expect(args[args.indexOf("-af") + 1]).toBe("apad,arealtime");
  });

  it("paces synthesized silence through a black tail without padding it", () => {
    const args = buildFfmpegArguments(
      item({ hasAudio: false, playDurationMs: 4_000, blackTailMs: 6_500 }),
    );

    expect(args[args.indexOf("-af") + 1]).toBe("arealtime");
    expect(args).toEqual(expect.arrayContaining(["-map", "1:a:0"]));
  });

  it("leaves the command unchanged when media covers its airtime", () => {
    const args = buildFfmpegArguments(item());

    expect(args).not.toContain("-af");
    expect(args.filter((arg) => arg === "-t")).toHaveLength(1);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid black tail %s before process creation",
    (blackTailMs) => {
      expect(() => buildFfmpegArguments(item({ blackTailMs }))).toThrowError(
        expect.objectContaining<Partial<SignalError>>({
          code: "invalid_playout_item",
          details: { field: "blackTailMs" },
        }),
      );
    },
  );

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

  it.each([undefined, null, 0, "yes"])(
    "rejects invalid audio-presence metadata %s before process creation",
    (hasAudio) => {
      expect(() =>
        buildFfmpegArguments(
          item({ hasAudio } as unknown as Partial<SignalPlayoutItem>),
        ),
      ).toThrowError(
        expect.objectContaining<Partial<SignalError>>({
          code: "invalid_playout_item",
          details: { field: "hasAudio" },
        }),
      );
    },
  );
});
