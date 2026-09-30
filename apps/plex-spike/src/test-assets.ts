import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export type TestAssetOptions = {
  label: "VIDEO A" | "VIDEO B";
  color: "blue" | "red";
  toneHz: 440 | 660;
  durationSeconds: number;
  outputPath: string;
  fontPath?: string;
};

type RunFfmpeg = (path: string, args: readonly string[]) => Promise<void>;

/** Resolves the ignored shared data directory independently of workspace CWD. */
export function defaultTestAssetDirectory(): string {
  return fileURLToPath(
    new URL("../../../data/signal-spike/", import.meta.url),
  ).replace(/[\\/]$/, "");
}

/** Expresses one identifiable asset as structured FFmpeg arguments. */
export function buildTestAssetArguments(
  options: TestAssetOptions,
): readonly string[] {
  const font = options.fontPath
    ? `fontfile='${escapeFilterPath(options.fontPath)}':`
    : "";
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${options.color}:s=1280x720:r=30:d=${options.durationSeconds}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${options.toneHz}:sample_rate=48000:duration=${options.durationSeconds}`,
    "-vf",
    `drawtext=${font}text='${options.label}  %{pts\\:hms}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.65`,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    options.outputPath,
  ];
}

/** Generates both controlled inputs without invoking a command shell. */
export async function generateTestAssets(
  ffmpegPath: string,
  assets: readonly TestAssetOptions[],
  run: RunFfmpeg = runFfmpeg,
): Promise<void> {
  for (const asset of assets) {
    await mkdir(dirname(asset.outputPath), { recursive: true });
    try {
      await run(ffmpegPath, buildTestAssetArguments(asset));
    } catch (cause) {
      throw new Error(
        `FFmpeg at ${ffmpegPath} could not generate ${asset.label}. Install FFmpeg or set KRAZITV_SPIKE_FFMPEG_PATH to a compatible executable.`,
        { cause },
      );
    }
  }
}

/** Escapes a filesystem path for FFmpeg's filter-option parser. */
function escapeFilterPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

/** Reports the failing FFmpeg exit while preserving its diagnostic output. */
function runFfmpeg(path: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, {
      shell: false,
      stdio: ["ignore", "inherit", "pipe"],
      windowsHide: true,
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `FFmpeg test-asset generation failed with exit ${code}: ${Buffer.concat(stderr).toString().trim()}`,
          ),
        );
      }
    });
  });
}
