import { SignalError } from "../../errors.js";
import type { SignalPlayoutItem } from "../../signal-packager/contracts.js";

const VIDEO_FILTER =
  "scale=1920:1080:force_original_aspect_ratio=decrease," +
  "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1";

/** Validates one selected item and expresses the MVP packaging policy as argv. */
export function buildFfmpegArguments(
  item: SignalPlayoutItem,
): readonly string[] {
  assertNonNegativeSafeInteger(item.mediaOffsetMs, "mediaOffsetMs");
  assertPositiveSafeInteger(item.playDurationMs, "playDurationMs");

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-re",
    "-ss",
    millisecondsToDecimalSeconds(item.mediaOffsetMs),
    "-i",
    item.mediaPath,
    "-t",
    millisecondsToDecimalSeconds(item.playDurationMs),
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
    VIDEO_FILTER,
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
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

/** Rejects invalid offsets at the packaging boundary with provider-neutral data. */
function assertNonNegativeSafeInteger(
  value: number,
  field: "mediaOffsetMs",
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidPlayoutItem(field);
  }
}

/** Rejects invalid durations before any process can be created. */
function assertPositiveSafeInteger(
  value: number,
  field: "playDurationMs",
): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw invalidPlayoutItem(field);
  }
}

/** Avoids echoing values or media paths into externally visible errors. */
function invalidPlayoutItem(
  field: "mediaOffsetMs" | "playDurationMs",
): SignalError {
  return new SignalError(
    "invalid_playout_item",
    `Signal playout item has an invalid ${field}`,
    { field },
  );
}
