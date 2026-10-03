// FFmpeg CLI helpers for the server's opt-in real-FFmpeg suite only.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** The binary the suite and the packager under test both run. */
export const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

/**
 * Runs FFmpeg to completion and returns its stderr, where it reports
 * progress. Throws naming `failure`, so a missing binary fails the suite
 * instead of skipping it.
 */
function runFfmpeg(
  args: readonly string[],
  failure: string,
  input?: Buffer,
): string {
  const result = spawnSync(ffmpegPath, ["-hide_banner", ...args], {
    input,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${failure} ("${ffmpegPath}"). Install FFmpeg or set FFMPEG_PATH: ${result.stderr?.trim() || result.error?.message}`,
      { cause: result.error },
    );
  }
  return result.stderr;
}

/**
 * Writes a test-pattern clip with a tone into `directory`, so the media a
 * channel airs is real, seekable, and has the audio fact the catalog records.
 */
export function generateClip(
  directory: string,
  name: string,
  durationMs: number,
): string {
  const path = join(directory, `${name}.mkv`);
  const seconds = durationMs / 1_000;
  runFfmpeg(
    [
      ...["-y", "-f", "lavfi", "-i", `testsrc2=s=320x240:r=30:d=${seconds}`],
      ...[
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:sample_rate=48000:d=${seconds}`,
      ],
      ...["-c:v", "libx264", "-g", "30", "-c:a", "aac", "-shortest", path],
    ],
    `FFmpeg could not generate the ${name} clip`,
  );
  return path;
}

/**
 * Decodes a viewer's capture end to end and returns how much video it held,
 * from FFmpeg's last progress report. Throws when the capture does not decode.
 */
export function decodedVideoMs(capture: Buffer): number {
  const report = runFfmpeg(
    ["-i", "pipe:0", "-map", "0:v:0", "-f", "null", "-"],
    "FFmpeg could not decode the viewer capture",
    capture,
  );
  const times = [...report.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = times.at(-1);
  if (last === undefined) throw new Error(`No decode progress:\n${report}`);
  const [hours, minutes, seconds] = [last[1], last[2], last[3]].map(Number);
  return Math.round(
    ((hours ?? 0) * 3_600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1_000,
  );
}

/**
 * Lists the command lines of running FFmpeg processes that reference
 * `pathFragment`, so a suite can prove a stopped channel left no child behind.
 */
export function runningFfmpegProcesses(pathFragment: string): string[] {
  const listing =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name like 'ffmpeg%'\" | ForEach-Object { $_.CommandLine }",
          ],
          { encoding: "utf8", windowsHide: true },
        )
      : spawnSync("ps", ["-eo", "args="], { encoding: "utf8" });
  if (listing.error || listing.status !== 0) {
    throw new Error(`Could not list processes: ${listing.stderr}`, {
      cause: listing.error,
    });
  }
  return listing.stdout
    .split(/\r?\n/)
    .filter((line) => line.includes(pathFragment) && /ffmpeg/i.test(line));
}
