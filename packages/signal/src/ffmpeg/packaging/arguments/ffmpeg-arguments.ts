import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@krazitv/process";

import { SignalError } from "../../../errors.js";
import { JOIN_BACKLOG_MS } from "../../join-backlog.js";
import { VIDEO_PID } from "../../mpeg-ts/mpeg-ts-packet-run.js";
import type { SignalPlayoutItem } from "../../../signal-packager/contracts.js";

const VIDEO_FILTER =
  "scale=1920:1080:force_original_aspect_ratio=decrease," +
  "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1";

const BLACK_TAIL_VIDEO_FILTER = "tpad=stop_mode=add:stop=-1:color=black";

const SILENT_AUDIO_SOURCE = "anullsrc=channel_layout=stereo:sample_rate=48000";
const BLACK_VIDEO_SOURCE = "color=c=black:s=1920x1080:r=30";

// The owner's wording for an item that cannot air. Unlike filler's, it names
// no time: the session cannot know when programming resumes.
const STAND_IN_MESSAGE = "Programming offline";

// Drops frame lookahead, so output starts as soon as input is read at
// wall-clock speed.
const ZERO_LATENCY_TUNING = ["-tune", "zerolatency"] as const;
// Encodes a burst fastest: input arrives at once, so lookahead costs nothing,
// and zerolatency's sliced threading would halve the speed.
const BURST_TUNING = ["-preset", "veryfast"] as const;

type ProgramItem = Extract<SignalPlayoutItem, { kind: "program" }>;
type FillerItem = Extract<SignalPlayoutItem, { kind: "filler" }>;

/** How the packager renders what it generates rather than reads. */
interface FfmpegArgumentOptions {
  /** The font filler messages are drawn in; unset uses fontconfig's default. */
  fontFile?: string | undefined;
  /**
   * Marks a session's first process, which a tune request waits on and its
   * first viewer joins. A program without a black tail starts up to the join
   * backlog earlier in its media and bursts that span, so the first viewer
   * gets the backlog later joiners replay (ADR 0018) while the live edge
   * stays on schedule. The tune waits until the burst is encoded, so a
   * bursting process uses x264's `veryfast` preset, which encoded it in
   * 2.6 s rather than 4.5 s on the reference machine. A first process with
   * nothing to burst drops x264's frame lookahead instead: under `-re`
   * pacing, lookahead held first output for about 1.8 s. A prepared process
   * keeps the defaults and no burst, because its lead hides the startup and
   * the retained signal already holds the backlog (ADR 0016).
   */
  startsSession?: boolean;
}

/** Validates one selected item and expresses the MVP packaging policy as argv. */
export function buildFfmpegArguments(
  item: SignalPlayoutItem,
  options: FfmpegArgumentOptions = {},
): readonly string[] {
  return item.kind === "filler"
    ? fillerArguments(item, options)
    : programArguments(item, options);
}

/**
 * How much media before its offset a session's first process bursts, so its
 * first viewer joins with the backlog later viewers replay (ADR 0018): up to
 * the join backlog, never before the media's start. Filler and black tails
 * are paced by real-time filters from their first frame, which would undo a
 * burst, so they start with none.
 */
export function sessionBacklogMs(item: SignalPlayoutItem): number {
  if (item.kind === "filler" || item.blackTailMs > 0) return 0;
  return Math.min(JOIN_BACKLOG_MS, item.mediaOffsetMs);
}

/** Packages a program from its media, generating any stream it lacks. */
function programArguments(
  item: ProgramItem,
  { startsSession = false }: FfmpegArgumentOptions,
): readonly string[] {
  const invalidField = findInvalidField(item);
  if (invalidField !== undefined) {
    throw invalidPlayoutItem(invalidField);
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
  const backlogMs = startsSession ? sessionBacklogMs(item) : 0;

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-re",
    ...(backlogMs > 0
      ? ["-readrate_initial_burst", millisecondsToDecimalSeconds(backlogMs)]
      : []),
    "-ss",
    millisecondsToDecimalSeconds(item.mediaOffsetMs - backlogMs),
    // A black tail stops the media read at its span so the output can run on.
    ...(hasBlackTail
      ? ["-t", millisecondsToDecimalSeconds(item.playDurationMs)]
      : []),
    "-i",
    item.mediaPath,
    ...generatedSources.flatMap((source) => ["-f", "lavfi", "-i", source]),
    "-t",
    millisecondsToDecimalSeconds(
      backlogMs + item.playDurationMs + item.blackTailMs,
    ),
    "-map",
    videoStream,
    "-map",
    audioStream,
    ...encodedOutput({
      encoderTuning:
        backlogMs > 0
          ? BURST_TUNING
          : startsSession || hasBlackTail
            ? ZERO_LATENCY_TUNING
            : [],
      videoFilter: hasBlackTail
        ? `${VIDEO_FILTER},${BLACK_TAIL_VIDEO_FILTER}`
        : VIDEO_FILTER,
      // `-re` paces input reads only, so the generated tail needs its own
      // wall-clock pacing. Pacing audio alone holds the interleaved video
      // too; a video `realtime` stage stacks with encoder buffering and can
      // lag. Synthesized silence never ends, so only source audio needs
      // padding.
      audioFilter: hasBlackTail
        ? item.hasAudio
          ? "apad,arealtime"
          : "arealtime"
        : undefined,
    }),
  ];
}

/**
 * Packages planned filler from generated sources alone: black video with
 * the message drawn centered, over silence, for exactly its airtime. Like
 * the black tail it reads nothing paced, so pacing the audio holds the
 * interleaved video to wall-clock time.
 */
function fillerArguments(
  item: FillerItem,
  { fontFile }: FfmpegArgumentOptions,
): readonly string[] {
  if (!isPositiveSafeInteger(item.airtimeMs)) {
    throw invalidPlayoutItem("airtimeMs");
  }
  if (item.message === "") throw invalidPlayoutItem("message");
  const drawtext = [
    `text=${escapeFilterValue(item.message)}`,
    // Messages are shown as written; `%{...}` is never expanded.
    "expansion=none",
    ...(fontFile === undefined
      ? []
      : [`fontfile=${escapeFilterValue(fontFile)}`]),
    "fontcolor=white",
    "fontsize=64",
    "x=(w-text_w)/2",
    "y=(h-text_h)/2",
  ].join(":");
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-f",
    "lavfi",
    "-i",
    BLACK_VIDEO_SOURCE,
    "-f",
    "lavfi",
    "-i",
    SILENT_AUDIO_SOURCE,
    "-t",
    millisecondsToDecimalSeconds(item.airtimeMs),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    ...encodedOutput({
      encoderTuning: ZERO_LATENCY_TUNING,
      videoFilter: `drawtext=${drawtext}`,
      audioFilter: "arealtime",
    }),
  ];
}

/**
 * Packages the stand-in for an item that cannot air (ADR 0020): filler's
 * card reading `STAND_IN_MESSAGE`, read from nothing, for at most the
 * item's whole airtime. The next commit truncates it, so it never needs the
 * time actually left.
 */
export function buildStandInArguments(
  item: SignalPlayoutItem,
  options: FfmpegArgumentOptions = {},
): readonly string[] {
  return fillerArguments(
    {
      kind: "filler",
      channelId: item.channelId,
      message: STAND_IN_MESSAGE,
      airtimeMs:
        item.kind === "filler"
          ? item.airtimeMs
          : item.playDurationMs + item.blackTailMs,
    },
    options,
  );
}

/**
 * The encoder and muxer settings every item shares, so programs and filler
 * reach one stable MPEG-TS stream layout: the same codecs, frame rate, GOP,
 * and PIDs across every FFmpeg process of a session.
 */
function encodedOutput({
  encoderTuning,
  videoFilter,
  audioFilter,
}: {
  /** x264 speed settings, which never change the stream layout. */
  encoderTuning: readonly string[];
  videoFilter: string;
  audioFilter: string | undefined;
}): string[] {
  return [
    "-c:v",
    "libx264",
    ...encoderTuning,
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
    videoFilter,
    ...(audioFilter === undefined ? [] : ["-af", audioFilter]),
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-streamid",
    `0:${VIDEO_PID}`,
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

/**
 * Escapes a value placed in a filter option inside a `-vf` filtergraph:
 * first for the option parser (`\`, `'`, `:`), then for the filtergraph
 * parser (`\`, `'`, `[`, `]`, `,`, `;`), so any message or font path is
 * read as text, never as filter syntax. No shell is involved.
 */
function escapeFilterValue(value: string): string {
  return value
    .replace(/[\\':]/g, (character) => `\\${character}`)
    .replace(/[\\'[\],;]/g, (character) => `\\${character}`);
}

type PackagingField =
  | "airtimeMs"
  | "blackTailMs"
  | "hasAudio"
  | "hasVideo"
  | "mediaOffsetMs"
  | "message"
  | "playDurationMs";

/**
 * Returns the first field FFmpeg cannot be given as-is, or undefined when the
 * item can be packaged. Checked in a fixed order, so an item with several bad
 * fields always reports the same one.
 */
function findInvalidField(item: ProgramItem): PackagingField | undefined {
  if (!isNonNegativeSafeInteger(item.mediaOffsetMs)) return "mediaOffsetMs";
  if (!isPositiveSafeInteger(item.playDurationMs)) return "playDurationMs";
  if (!isNonNegativeSafeInteger(item.blackTailMs)) return "blackTailMs";
  if (typeof item.hasAudio !== "boolean") return "hasAudio";
  if (typeof item.hasVideo !== "boolean") return "hasVideo";
  return undefined;
}

/** Converts exact integer milliseconds without introducing float rounding. */
function millisecondsToDecimalSeconds(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  const remainder = milliseconds % 1_000;
  return `${seconds}.${remainder.toString().padStart(3, "0")}`;
}

/** Avoids echoing values or media paths into externally visible errors. */
function invalidPlayoutItem(field: PackagingField): SignalError {
  return new SignalError(
    "invalid_playout_item",
    `Signal playout item has an invalid ${field}`,
    { field },
  );
}
