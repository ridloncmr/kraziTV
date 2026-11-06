// Applies an encoding plan to the argv the production packager built, so the
// spike changes only the encoder settings and leaves pacing, mapping, PIDs,
// and muxing exactly as `buildFfmpegArguments` wrote them. Filler, stand-ins,
// and anything this file does not recognize pass through unchanged.

import { planEncoding } from "./encoding-plan.mjs";

/** The packager's fixed program filter, as written in ffmpeg-arguments.ts. */
const LEGACY_VIDEO_FILTER =
  "scale=1920:1080:force_original_aspect_ratio=decrease," +
  "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1";

/** Encoder options a copy drops; each takes one value. */
const ENCODER_OPTIONS = new Set([
  "-c:v",
  "-tune",
  "-preset",
  "-pix_fmt",
  "-r",
  "-g",
  "-keyint_min",
  "-sc_threshold",
  "-vf",
]);

/**
 * Rewrites one FFmpeg argv. Returns the argv to run and the decision made,
 * or the original argv with `decision: undefined` when the command is not a
 * program the packager built from media.
 */
export function rewriteFfmpegArguments(args, { mode, ceiling, probe }) {
  const request = readRequest(args);
  if (request === undefined) return { args, decision: undefined };

  const facts = probe(request.mediaPath);
  const plan = planEncoding({ facts, request, mode, ceiling });
  const decision = { mediaPath: request.mediaPath, facts, request, plan };
  if (plan.strategy === "legacy") return { args, decision };
  if (plan.strategy === "copy") return { args: copyArguments(args), decision };
  const rewritten = nativeEncodeArguments(args, plan.video, request);
  if (rewritten === undefined) {
    plan.strategy = "legacy";
    plan.reasons.push("filter graph not recognized; argv left alone");
    return { args, decision };
  }
  return { args: rewritten, decision };
}

/**
 * Reads what the packager asked for from its argv: the media input (the
 * first `-i` not preceded by `-f lavfi`), the seek offset, whether the
 * source's video is mapped, and the markers of a session's first process
 * (burst or zero-latency tuning) and of a black tail (`tpad` in the filter).
 */
function readRequest(args) {
  let mediaPath;
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "-i" && args[index - 1] !== "lavfi") {
      mediaPath = args[index + 1];
      break;
    }
  }
  if (mediaPath === undefined) return undefined;
  const value = (option) => {
    const at = args.indexOf(option);
    return at === -1 ? undefined : args[at + 1];
  };
  const seek = value("-ss");
  const filter = value("-vf") ?? "";
  return {
    mediaPath,
    offsetMs: seek === undefined ? 0 : Math.round(Number(seek) * 1000),
    sourceVideoMapped: args.some(
      (token, index) => args[index - 1] === "-map" && token.startsWith("0:v"),
    ),
    startsSession:
      args.includes("-readrate_initial_burst") ||
      args.includes("zerolatency") ||
      value("-preset") !== undefined,
    blackTail: filter.includes("tpad="),
  };
}

/** Drops every video encoder option and copies the source video stream. */
function copyArguments(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (ENCODER_OPTIONS.has(token)) {
      if (token === "-c:v") result.push("-c:v", "copy");
      index += 1;
      continue;
    }
    result.push(token);
  }
  return result;
}

/**
 * Replaces the fixed scale-and-pad filter with the plan's chain, keeps any
 * black-tail suffix, and sets the frame rate and GOP to the source's.
 * Returns undefined when the filter is not the one the packager writes.
 */
function nativeEncodeArguments(args, video, request) {
  const filterAt = args.indexOf("-vf");
  if (filterAt === -1 || !args[filterAt + 1].startsWith(LEGACY_VIDEO_FILTER)) {
    return undefined;
  }
  const suffix = args[filterAt + 1].slice(LEGACY_VIDEO_FILTER.length);
  const chain = [
    ...(video.deinterlace ? ["bwdif=mode=send_frame"] : []),
    ...(video.scale ? [`scale=${video.width}:${video.height}`] : []),
  ].join(",");
  const filter = chain + (chain === "" ? suffix.replace(/^,/, "") : suffix);

  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "-vf") {
      if (filter !== "") result.push("-vf", filter);
      index += 1;
    } else if (token === "-r") {
      result.push("-r", video.frameRate);
      index += 1;
    } else if (token === "-g" || token === "-keyint_min") {
      result.push(token, String(video.gop));
      index += 1;
    } else {
      result.push(token);
    }
  }
  void request;
  return result;
}
