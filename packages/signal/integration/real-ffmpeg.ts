// Real-FFmpeg helpers shared by this package's opt-in integration suites; nothing under src/ imports them.
import { spawnSync } from "node:child_process";

/** The FFmpeg the suites run: `FFMPEG_PATH`, else the one on PATH. */
export const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

/**
 * Runs FFmpeg to completion and returns its stderr, where FFmpeg writes its
 * stream and filter reports. Fails the suite rather than skipping when
 * FFmpeg is missing.
 */
export function runFfmpeg(
  args: readonly string[],
  failure: string,
  input?: Buffer,
): string {
  const result = spawnSync(
    ffmpegPath,
    // The capture arrives on stdin, so `-nostdin` is never passed here.
    args[0] === "-version" ? args : ["-hide_banner", ...args],
    {
      input,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `${failure} ("${ffmpegPath}"). Install FFmpeg or set FFMPEG_PATH: ${result.stderr?.trim() || result.error?.message}`,
      { cause: result.error },
    );
  }
  return result.stderr;
}

/** Lets a real broadcast run for a fixed wall-clock span. */
export function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}
