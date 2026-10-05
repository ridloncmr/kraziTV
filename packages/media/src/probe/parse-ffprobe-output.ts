import type { MediaProbeResult } from "./contracts.js";
import { MediaProbeError } from "./media-probe-error.js";

/**
 * Normalizes ffprobe JSON output. Only duration and audio and video presence
 * cross this boundary; anything else ffprobe reports stays private to the adapter.
 */
export function parseFfprobeOutput(stdout: string): MediaProbeResult {
  let document: unknown;
  try {
    document = JSON.parse(stdout);
  } catch (cause) {
    throw new MediaProbeError(
      "invalid_json",
      "ffprobe returned malformed JSON",
      {
        cause,
      },
    );
  }

  if (!isRecord(document) || !isRecord(document.format)) {
    throw invalidMetadata("ffprobe output has no format section");
  }

  const streams = parseStreams(document.streams);
  return {
    durationMs: parseDurationMs(document.format.duration),
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
    hasVideo: streams.some(
      (stream) =>
        stream.codec_type === "video" &&
        !(
          isRecord(stream.disposition) && stream.disposition.attached_pic === 1
        ),
    ),
  };
}

// ffprobe's JSON writer prints durations as plain decimal seconds, e.g. "1320.042000".
const DECIMAL_SECONDS = /^(\d+)(?:\.(\d+))?$/;

/**
 * Rounds once to the nearest millisecond (halves up) and accepts only positive
 * safe integers. Rounding the decimal digits directly avoids float drift that
 * would turn "0.500500" into 500 ms instead of 501 ms.
 */
function parseDurationMs(duration: unknown): number {
  const match =
    typeof duration === "string" ? DECIMAL_SECONDS.exec(duration) : null;
  if (!match) {
    throw invalidMetadata(
      `ffprobe reported an unusable duration: ${String(duration)}`,
    );
  }

  const [, wholeSeconds = "", fraction = ""] = match;
  const fractionDigits = fraction.padEnd(4, "0");
  const roundUp = fractionDigits[3] >= "5" ? 1 : 0;
  const durationMs =
    Number(wholeSeconds) * 1000 + Number(fractionDigits.slice(0, 3)) + roundUp;

  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw invalidMetadata(
      `ffprobe reported an unusable duration: ${String(duration)}`,
    );
  }
  return durationMs;
}

/**
 * Treats an absent stream list as no streams; any other non-array is
 * malformed. Entries that are not objects are skipped.
 */
function parseStreams(streams: unknown): Record<string, unknown>[] {
  if (streams === undefined) return [];
  if (!Array.isArray(streams)) {
    throw invalidMetadata("ffprobe reported a malformed stream list");
  }
  return streams.filter(isRecord);
}

/** Narrows parsed JSON to an indexable object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Builds the error for JSON that parsed but lacks usable probe facts. */
function invalidMetadata(message: string): MediaProbeError {
  return new MediaProbeError("invalid_metadata", message);
}
