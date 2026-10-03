import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@krazitv/process";

import { SignalError } from "../../errors.js";
import type { SignalPlayoutItem } from "../../signal-packager/contracts.js";

const VIDEO_FILTER =
  "scale=1920:1080:force_original_aspect_ratio=decrease," +
  "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1";

const BLACK_TAIL_VIDEO_FILTER = "tpad=stop_mode=add:stop=-1:color=black";

/** Validates one selected item and expresses the MVP packaging policy as argv. */
export function buildFfmpegArguments(
  item: SignalPlayoutItem,
): readonly string[] {
  if (!isNonNegativeSafeInteger(item.mediaOffsetMs)) {
    throw invalidPlayoutItem("mediaOffsetMs");
  }
  if (!isPositiveSafeInteger(item.playDurationMs)) {
    throw invalidPlayoutItem("playDurationMs");
  }
  if (!isNonNegativeSafeInteger(item.blackTailMs)) {
    throw invalidPlayoutItem("blackTailMs");
  }
  if (typeof item.hasAudio !== "boolean") {
    throw invalidPlayoutItem("hasAudio");
  }
  const audioInput = item.hasAudio
    ? []
    : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
  const hasBlackTail = item.blackTailMs > 0;

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-re",
    "-ss",
    millisecondsToDecimalSeconds(item.mediaOffsetMs),
    // A black tail stops the media read at its span so the output can run on.
    ...(hasBlackTail
      ? ["-t", millisecondsToDecimalSeconds(item.playDurationMs)]
      : []),
    "-i",
    item.mediaPath,
    ...audioInput,
    "-t",
    millisecondsToDecimalSeconds(item.playDurationMs + item.blackTailMs),
    "-map",
    "0:v:0",
    "-map",
    item.hasAudio ? "0:a:0" : "1:a:0",
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
    hasBlackTail ? `${VIDEO_FILTER},${BLACK_TAIL_VIDEO_FILTER}` : VIDEO_FILTER,
    // `-re` paces input reads only, so the generated tail needs its own
    // wall-clock pacing. Pacing audio alone holds the interleaved video too;
    // a video `realtime` stage stacks with encoder buffering and can lag.
    // Synthesized silence never ends, so only source audio needs padding.
    ...(hasBlackTail
      ? ["-af", item.hasAudio ? "apad,arealtime" : "arealtime"]
      : []),
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
  ];
}

/** Converts exact integer milliseconds without introducing float rounding. */
function millisecondsToDecimalSeconds(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  const remainder = milliseconds % 1_000;
  return `${seconds}.${remainder.toString().padStart(3, "0")}`;
}

/** Avoids echoing values or media paths into externally visible errors. */
function invalidPlayoutItem(
  field: "blackTailMs" | "hasAudio" | "mediaOffsetMs" | "playDurationMs",
): SignalError {
  return new SignalError(
    "invalid_playout_item",
    `Signal playout item has an invalid ${field}`,
    { field },
  );
}
