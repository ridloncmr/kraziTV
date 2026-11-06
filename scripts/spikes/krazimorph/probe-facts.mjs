// Reads the source facts the encoding plan needs from one media file with
// ffprobe, synchronously, so the spawn rewrite can use them inline. Facts are
// cached per path for the life of the process. The elapsed time is kept so
// the spike also measures what an extended probe would cost a catalog scan.

import { spawnSync } from "node:child_process";

const cache = new Map();

/** Fields the plan reads; everything else ffprobe knows stays out. */
const STREAM_ENTRIES = [
  "codec_name",
  "profile",
  "level",
  "width",
  "height",
  "pix_fmt",
  "field_order",
  "r_frame_rate",
  "avg_frame_rate",
  "sample_aspect_ratio",
  "display_aspect_ratio",
  "color_transfer",
  "bit_rate",
].join(",");

/**
 * Probes the first video stream of `path`. Returns `undefined` when ffprobe
 * fails or the file has no video, which the plan treats as "facts unknown".
 */
export function probeVideoFacts(path, ffprobePath = defaultFfprobePath()) {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;
  const startedAt = performance.now();
  const result = spawnSync(
    ffprobePath,
    [
      ...["-v", "error", "-print_format", "json"],
      ...[
        "-select_streams",
        "v:0",
        "-show_entries",
        `stream=${STREAM_ENTRIES}`,
      ],
      ...["-i", path],
    ],
    { encoding: "utf8", shell: false, windowsHide: true, timeout: 20_000 },
  );
  const probeMs = Math.round(performance.now() - startedAt);
  let facts;
  if (result.status === 0) {
    try {
      const stream = JSON.parse(result.stdout).streams?.[0];
      if (stream) facts = normalize(stream, probeMs);
    } catch {
      facts = undefined;
    }
  }
  const outcome = facts ?? {
    unknown: true,
    probeMs,
    error: result.stderr?.trim(),
  };
  cache.set(path, outcome);
  return outcome;
}

/** Turns ffprobe's strings into the numbers and names the plan compares. */
function normalize(stream, probeMs) {
  return {
    codec: stream.codec_name,
    profile: stream.profile,
    level: stream.level,
    width: Number(stream.width),
    height: Number(stream.height),
    pixelFormat: stream.pix_fmt,
    fieldOrder: stream.field_order ?? "unknown",
    frameRate: parseRate(stream.r_frame_rate),
    averageFrameRate: parseRate(stream.avg_frame_rate),
    sampleAspectRatio: stream.sample_aspect_ratio,
    displayAspectRatio: stream.display_aspect_ratio,
    colorTransfer: stream.color_transfer,
    bitRate:
      stream.bit_rate === undefined ? undefined : Number(stream.bit_rate),
    probeMs,
  };
}

/** Parses ffprobe's `num/den` rate into a rational and its decimal value. */
function parseRate(text) {
  const match = /^(\d+)\/(\d+)$/.exec(text ?? "");
  if (!match || Number(match[2]) === 0) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (numerator === 0) return undefined;
  return {
    text: `${numerator}/${denominator}`,
    value: numerator / denominator,
  };
}

/** The ffprobe the server would use: `FFPROBE_PATH`, else the one on PATH. */
export function defaultFfprobePath() {
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}
