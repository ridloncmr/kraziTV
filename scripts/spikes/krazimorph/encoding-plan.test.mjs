import { describe, expect, it } from "vitest";

import { planEncoding } from "./encoding-plan.mjs";
import { rewriteFfmpegArguments } from "./rewrite-arguments.mjs";

/** A copy-eligible 720p24 H.264 source, as probe-facts.mjs reports it. */
const h264_720p24 = {
  codec: "h264",
  profile: "High",
  width: 1280,
  height: 720,
  pixelFormat: "yuv420p",
  fieldOrder: "progressive",
  frameRate: { text: "24000/1001", value: 23.976 },
  probeMs: 40,
};

const interlacedMpeg2 = {
  codec: "mpeg2video",
  width: 720,
  height: 480,
  pixelFormat: "yuv420p",
  fieldOrder: "tt",
  frameRate: { text: "30000/1001", value: 29.97 },
  probeMs: 40,
};

const boundaryStart = {
  offsetMs: 0,
  startsSession: false,
  blackTail: false,
  sourceVideoMapped: true,
};

/** The argv `buildFfmpegArguments` writes for a prepared program. */
function packagerArguments({ seek = "0.000", tuning = [], tail = "" } = {}) {
  return [
    ...["-hide_banner", "-nostdin", "-loglevel", "warning", "-re"],
    ...["-ss", seek, "-i", "/media/show.mkv"],
    ...["-t", "600.000", "-map", "0:v:0", "-map", "0:a:0"],
    ...["-c:v", "libx264", ...tuning, "-pix_fmt", "yuv420p"],
    ...["-r", "30", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0"],
    ...[
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease," +
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1" +
        tail,
    ],
    ...["-c:a", "aac", "-ar", "48000", "-ac", "2"],
    ...["-streamid", "0:256", "-streamid", "1:257"],
    ...["-mpegts_start_pid", "256", "-mpegts_pmt_start_pid", "4096"],
    ...["-f", "mpegts", "pipe:1"],
  ];
}

describe("planEncoding", () => {
  it("copies an H.264 source under the ceiling at a boundary start", () => {
    const plan = planEncoding({
      facts: h264_720p24,
      request: boundaryStart,
      mode: "auto",
      ceiling: 1080,
    });
    expect(plan.strategy).toBe("copy");
    expect(plan.video).toMatchObject({ width: 1280, height: 720, gop: 24 });
  });

  it("encodes a session's first process even when the source could be copied", () => {
    const plan = planEncoding({
      facts: h264_720p24,
      request: { ...boundaryStart, startsSession: true },
      mode: "auto",
      ceiling: 1080,
    });
    expect(plan.strategy).toBe("encode");
    expect(plan.reasons).toContain("no copy: first process of a session");
    expect(plan.video.scale).toBe(false);
  });

  it("deinterlaces and keeps native size for interlaced MPEG-2", () => {
    const plan = planEncoding({
      facts: interlacedMpeg2,
      request: boundaryStart,
      mode: "auto",
      ceiling: 1080,
    });
    expect(plan.strategy).toBe("encode");
    expect(plan.video).toMatchObject({
      width: 720,
      height: 480,
      deinterlace: true,
      frameRate: "30000/1001",
      gop: 30,
    });
  });

  it("downscales to the ceiling box with even sizes", () => {
    const plan = planEncoding({
      facts: { ...h264_720p24, width: 3840, height: 2160 },
      request: boundaryStart,
      mode: "native",
      ceiling: 720,
    });
    expect(plan.video).toMatchObject({ width: 1280, height: 720, scale: true });
  });

  it("falls back to the legacy profile when facts are unknown or mode is off", () => {
    const unknown = planEncoding({
      facts: { unknown: true },
      request: boundaryStart,
      mode: "auto",
      ceiling: 1080,
    });
    const off = planEncoding({
      facts: h264_720p24,
      request: boundaryStart,
      mode: "off",
      ceiling: 1080,
    });
    expect(unknown.strategy).toBe("legacy");
    expect(off.strategy).toBe("legacy");
  });
});

describe("rewriteFfmpegArguments", () => {
  it("leaves filler alone", () => {
    const filler = [
      "-f",
      "lavfi",
      "-i",
      "color=c=black",
      "-f",
      "mpegts",
      "pipe:1",
    ];
    const { args, decision } = rewriteFfmpegArguments(filler, {
      mode: "auto",
      ceiling: 1080,
      probe: () => h264_720p24,
    });
    expect(args).toBe(filler);
    expect(decision).toBeUndefined();
  });

  it("replaces the encoder with a copy and keeps pacing, maps, and muxing", () => {
    const { args, decision } = rewriteFfmpegArguments(packagerArguments(), {
      mode: "auto",
      ceiling: 1080,
      probe: () => h264_720p24,
    });
    expect(decision.plan.strategy).toBe("copy");
    expect(args).toEqual([
      ...["-hide_banner", "-nostdin", "-loglevel", "warning", "-re"],
      ...["-ss", "0.000", "-i", "/media/show.mkv"],
      ...["-t", "600.000", "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy"],
      ...["-c:a", "aac", "-ar", "48000", "-ac", "2"],
      ...["-streamid", "0:256", "-streamid", "1:257"],
      ...["-mpegts_start_pid", "256", "-mpegts_pmt_start_pid", "4096"],
      ...["-f", "mpegts", "pipe:1"],
    ]);
  });

  it("encodes a mid-item start natively, keeping the black-tail filter", () => {
    const { args, decision } = rewriteFfmpegArguments(
      packagerArguments({
        seek: "12.500",
        tuning: ["-tune", "zerolatency"],
        tail: ",tpad=stop_mode=add:stop=-1:color=black",
      }),
      { mode: "auto", ceiling: 1080, probe: () => interlacedMpeg2 },
    );
    expect(decision.plan.strategy).toBe("encode");
    expect(args).toContain("-tune");
    expect(args[args.indexOf("-vf") + 1]).toBe(
      "bwdif=mode=send_frame,tpad=stop_mode=add:stop=-1:color=black",
    );
    expect(args[args.indexOf("-r") + 1]).toBe("30000/1001");
    expect(args[args.indexOf("-g") + 1]).toBe("30");
  });

  it("drops the filter entirely when nothing needs filtering", () => {
    const { args } = rewriteFfmpegArguments(
      packagerArguments({ tuning: ["-preset", "veryfast"] }),
      { mode: "native", ceiling: 1080, probe: () => h264_720p24 },
    );
    expect(args).not.toContain("-vf");
    expect(args[args.indexOf("-r") + 1]).toBe("24000/1001");
  });
});
