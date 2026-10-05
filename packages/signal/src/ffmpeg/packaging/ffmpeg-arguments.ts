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

const SILENT_AUDIO_SOURCE = "anullsrc=channel_layout=stereo:sample_rate=48000";
const BLACK_VIDEO_SOURCE = "color=c=black:s=1920x1080:r=30";

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
  if (typeof item.hasVideo !== "boolean") {
    throw invalidPlayoutItem("hasVideo");
  }
  // A stream the media lacks is generated, so every item reaches the same
  // two output streams: silence for audio, black for video. Generated inputs
  // follow the media at input 0 in this order.
  const generatedSources = [
    ...(item.hasAudio ? [] : [SILENT_AUDIO_SOURCE]),
    ...(item.hasVideo ? [] : [BLACK_VIDEO_SOURCE]),
  ];
  const inputIndex = (source: string): number =>
    generatedSources.indexOf(source) + 1;
  const audioStream = item.hasAudio
    ? "0:a:0"
    : `${inputIndex(SILENT_AUDIO_SOURCE)}:a:0`;
  const videoStream = item.hasVideo
    ? "0:v:0"
    : `${inputIndex(BLACK_VIDEO_SOURCE)}:v:0`;
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
    ...generatedSources.flatMap((source) => ["-f", "lavfi", "-i", source]),
    "-t",
    millisecondsToDecimalSeconds(item.playDurationMs + item.blackTailMs),
    "-map",
    videoStream,
    "-map",
    audioStream,
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
  field:
    | "blackTailMs"
    | "hasAudio"
    | "hasVideo"
    | "mediaOffsetMs"
    | "playDurationMs",
): SignalError {
  return new SignalError(
    "invalid_playout_item",
    `Signal playout item has an invalid ${field}`,
    { field },
  );
}
