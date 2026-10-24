import { describe, expect, it } from "vitest";

import { SignalError } from "../../errors.js";
import type { SignalPlayoutItem } from "../../signal-packager/contracts.js";
import { buildFfmpegArguments } from "./ffmpeg-arguments.js";

type ProgramItem = Extract<SignalPlayoutItem, { kind: "program" }>;
type FillerItem = Extract<SignalPlayoutItem, { kind: "filler" }>;

const item = (overrides: Partial<ProgramItem> = {}): ProgramItem => ({
  kind: "program",
  channelId: "channel-1",
  scheduleEntryId: "entry-1",
  mediaItemId: "media-1",
  mediaPath: "C:/media/My Movie.mkv",
  hasAudio: true,
  hasVideo: true,
  mediaOffsetMs: 12_345,
  playDurationMs: 67_890,
  blackTailMs: 0,
  ...overrides,
});

/** The stream each `-map` selects, in output order. */
const mappedStreams = (args: readonly string[]): string[] =>
  args.flatMap((arg, index) => (arg === "-map" ? [args[index + 1] ?? ""] : []));

/** The generated sources each lavfi input reads, in input order. */
const lavfiSources = (args: readonly string[]): string[] =>
  args.flatMap((arg, index) =>
    arg === "lavfi" && args[index + 1] === "-i" ? [args[index + 2] ?? ""] : [],
  );

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

  it("renders black video for media without a video stream", () => {
    const args = buildFfmpegArguments(item({ hasVideo: false }));

    expect(args.slice(args.indexOf("C:/media/My Movie.mkv") + 1)).toEqual(
      expect.arrayContaining([
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1920x1080:r=30",
      ]),
    );
    expect(mappedStreams(args)).toEqual(["1:v:0", "0:a:0"]);
    expect(args).toEqual(expect.arrayContaining(["-streamid", "0:256"]));
  });

  it("synthesizes both streams for media with neither audio nor video", () => {
    const args = buildFfmpegArguments(
      item({ hasAudio: false, hasVideo: false }),
    );

    expect(lavfiSources(args)).toEqual([
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "color=c=black:s=1920x1080:r=30",
    ]);
    expect(mappedStreams(args)).toEqual(["2:v:0", "1:a:0"]);
  });

  it("drops encoder lookahead from a session's first program when it has nothing to burst", () => {
    const first = buildFfmpegArguments(item({ mediaOffsetMs: 0 }), {
      startsSession: true,
    });
    const libx264 = first.indexOf("libx264");

    expect(first.slice(libx264 + 1, libx264 + 3)).toEqual([
      "-tune",
      "zerolatency",
    ]);
    expect(buildFfmpegArguments(item(), { startsSession: false })).toEqual(
      buildFfmpegArguments(item()),
    );
  });

  it("starts a session's first program the join backlog early and bursts it", () => {
    const args = buildFfmpegArguments(item({ mediaOffsetMs: 62_345 }), {
      startsSession: true,
    });

    expect(args.slice(4, 10)).toEqual([
      "-re",
      "-readrate_initial_burst",
      "10.000",
      "-ss",
      "52.345",
      "-i",
    ]);
    // The output runs the backlog longer, so it still ends at the boundary.
    expect(args[args.indexOf("-map") - 1]).toBe("77.890");
    // The tune waits on the burst, so it encodes fast, keeping lookahead.
    const libx264 = args.indexOf("libx264");
    expect(args.slice(libx264 + 1, libx264 + 3)).toEqual([
      "-preset",
      "veryfast",
    ]);
    expect(args).not.toContain("zerolatency");
  });

  it("bursts no further back than the start of the media", () => {
    const args = buildFfmpegArguments(item({ mediaOffsetMs: 4_000 }), {
      startsSession: true,
    });

    expect(args.slice(4, 9)).toEqual([
      "-re",
      "-readrate_initial_burst",
      "4.000",
      "-ss",
      "0.000",
    ]);
    expect(args[args.indexOf("-map") - 1]).toBe("71.890");
  });

  it("starts a first program at its offset with no burst when there is nothing before it or it has a black tail", () => {
    for (const first of [
      item({ mediaOffsetMs: 0 }),
      item({ playDurationMs: 4_000, blackTailMs: 6_500 }),
    ]) {
      const args = buildFfmpegArguments(first, { startsSession: true });

      expect(args).not.toContain("-readrate_initial_burst");
      expect(args[args.indexOf("-ss") + 1]).toBe(
        (first.mediaOffsetMs / 1_000).toFixed(3),
      );
    }
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
    expect(args).toEqual(expect.arrayContaining(["-tune", "zerolatency"]));
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
    "rejects invalid video-presence metadata %s before process creation",
    (hasVideo) => {
      expect(() =>
        buildFfmpegArguments(
          item({ hasVideo } as unknown as Partial<ProgramItem>),
        ),
      ).toThrowError(
        expect.objectContaining<Partial<SignalError>>({
          code: "invalid_playout_item",
          details: { field: "hasVideo" },
        }),
      );
    },
  );

  it.each([undefined, null, 0, "yes"])(
    "rejects invalid audio-presence metadata %s before process creation",
    (hasAudio) => {
      expect(() =>
        buildFfmpegArguments(
          item({ hasAudio } as unknown as Partial<ProgramItem>),
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

describe("buildFfmpegArguments: filler", () => {
  const filler = (overrides: Partial<FillerItem> = {}): FillerItem => ({
    kind: "filler",
    channelId: "channel-1",
    message: "Programming resumes at 8:00 PM",
    airtimeMs: 900_000,
    ...overrides,
  });

  it("renders black video with the message over silence for exactly its airtime, with no media input", () => {
    expect(buildFfmpegArguments(filler())).toEqual([
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "warning",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1920x1080:r=30",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-t",
      "900.000",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-tune",
      "zerolatency",
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
      "drawtext=text=Programming resumes at 8\\\\:00 PM:expansion=none:fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2",
      // Generated sources are unpaced; pacing the audio holds the video too.
      "-af",
      "arealtime",
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

  it("escapes what the filter options or the filtergraph would read as syntax, leaving % literal", () => {
    const args = buildFfmpegArguments(
      filler({ message: "It's 50%: a\\b, [c]; d" }),
    );

    // Option level: \ ' : gain a backslash; then filtergraph level: \ ' [ ] , ;
    expect(args[args.indexOf("-vf") + 1]).toMatch(
      /^drawtext=text=It\\\\\\'s 50%\\\\: a\\\\\\\\b\\, \\\[c\\\]\\; d:expansion=none:/,
    );
  });

  it("names a configured font file, escaped like the message", () => {
    const args = buildFfmpegArguments(filler(), {
      fontFile: "C:/Windows/Fonts/arial.ttf",
    });

    expect(args[args.indexOf("-vf") + 1]).toContain(
      ":fontfile=C\\\\:/Windows/Fonts/arial.ttf:",
    );
  });

  it.each([
    { name: "a zero airtime", overrides: { airtimeMs: 0 }, field: "airtimeMs" },
    { name: "an empty message", overrides: { message: "" }, field: "message" },
  ])("refuses $name", ({ overrides, field }) => {
    expect(() => buildFfmpegArguments(filler(overrides))).toThrow(
      expect.objectContaining({
        code: "invalid_playout_item",
        details: { field },
      }),
    );
  });
});
