// Generates the spike's labeled test media: each clip shows its own name and
// a running clock and plays a tone of its own, so a viewer can see which clip
// is airing and whether a splice froze, skipped, or went silent.
//
// Usage:
//   node scripts/spikes/krazimorph/make-fixtures.mjs [--out DIR] [--seconds N]
//
// Defaults: DIR = data/krazimorph/fixtures, N = 90. Point a media root at DIR,
// scan it, and build a channel from the clips.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..", "..");

/** The ffmpeg the fixtures are made with: `FFMPEG_PATH`, else the one on PATH. */
export const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

/**
 * The clips, one per question the spike asks. `make` returns the argv tail
 * from the video source through the encoder, given the clip length.
 */
export const FIXTURES = [
  {
    name: "KM-A 1080p30 H264",
    file: "KM-A-1080p30-h264.mkv",
    tone: 440,
    expect: "copy in auto mode; today's profile already, so the control",
    make: (seconds) => [
      ...["-f", "lavfi", "-i", `testsrc2=s=1920x1080:r=30:d=${seconds}`],
      ...["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"],
    ],
  },
  {
    name: "KM-B 720p24 H264 bframes gop5s",
    file: "KM-B-720p24-h264-gop5.mkv",
    tone: 523,
    expect:
      "copy in auto mode; a resolution and frame-rate change at the splice",
    make: (seconds) => [
      ...["-f", "lavfi", "-i", `testsrc2=s=1280x720:r=24000/1001:d=${seconds}`],
      ...["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"],
      ...["-g", "120", "-keyint_min", "120", "-bf", "3"],
    ],
  },
  {
    name: "KM-C 480i MPEG2 anamorphic",
    file: "KM-C-480i-mpeg2-anamorphic.mkv",
    tone: 587,
    expect: "encode at 720x480 with bwdif; combing if deinterlacing is skipped",
    make: (seconds) => [
      // Sixty progressive frames a second interleaved into fields, so the
      // interlace carries real motion between fields.
      ...["-f", "lavfi", "-i", `testsrc2=s=720x480:r=60000/1001:d=${seconds}`],
      ...["-vf", "tinterlace=mode=interleave_top,setsar=8/9"],
      ...["-c:v", "mpeg2video", "-q:v", "4", "-flags", "+ilme+ildct"],
      ...["-field_order", "tt", "-pix_fmt", "yuv420p"],
    ],
  },
  {
    name: "KM-D 1080p24 HEVC 10bit",
    file: "KM-D-1080p24-hevc-10bit.mkv",
    tone: 659,
    expect: "encode: wrong codec and pixel format for copy",
    make: (seconds) => [
      ...[
        "-f",
        "lavfi",
        "-i",
        `testsrc2=s=1920x1080:r=24000/1001:d=${seconds}`,
      ],
      ...["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le"],
      ...["-x265-params", "log-level=error"],
    ],
  },
  {
    name: "KM-E 1080p60 H264",
    file: "KM-E-1080p60-h264.mkv",
    tone: 784,
    expect: "copy in auto mode; a 60 fps stream after a 30 fps one",
    make: (seconds) => [
      ...["-f", "lavfi", "-i", `testsrc2=s=1920x1080:r=60:d=${seconds}`],
      ...["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"],
    ],
  },
  {
    name: "KM-F 2160p24 H264",
    file: "KM-F-2160p24-h264.mkv",
    tone: 880,
    expect: "encode, downscaled to the ceiling",
    make: (seconds) => [
      ...["-f", "lavfi", "-i", `testsrc2=s=3840x2160:r=24:d=${seconds}`],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
    ],
  },
];

/**
 * Writes one fixture. The label is drawn after the fixture's own filters so
 * it lands on the final frame; the tone makes silence mean a hole.
 */
export function generateFixture(fixture, directory, seconds, fontFile) {
  const path = join(directory, fixture.file);
  const tail = fixture.make(seconds);
  // Single-quoted values: the clock expansion keeps its one `\:`, and a
  // Windows font path needs only its drive colon escaped.
  const label = [
    `text='${fixture.name.replace(/'/g, "")}  %{pts\\:hms}'`,
    ...(fontFile ? [`fontfile='${quoteFilterPath(fontFile)}'`] : []),
    "fontcolor=white",
    "box=1",
    "boxcolor=black@0.6",
    "fontsize=h/12",
    "x=(w-text_w)/2",
    "y=h*0.72",
  ].join(":");
  const videoFilterAt = tail.indexOf("-vf");
  const args = [
    ...["-hide_banner", "-loglevel", "error", "-y"],
    ...tail.slice(0, videoFilterAt === -1 ? 4 : videoFilterAt),
    ...[
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${fixture.tone}:sample_rate=48000:d=${seconds}`,
    ],
    ...["-map", "0:v:0", "-map", "1:a:0"],
    ...(videoFilterAt === -1
      ? ["-vf", `drawtext=${label}`, ...tail.slice(4)]
      : [
          "-vf",
          `${tail[videoFilterAt + 1]},drawtext=${label}`,
          ...tail.slice(videoFilterAt + 2),
        ]),
    ...["-c:a", "aac", "-b:a", "128k", path],
  ];
  const result = spawnSync(ffmpegPath, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    rmSync(path, { force: true });
    throw new Error(
      `FFmpeg could not generate ${fixture.file}: ${result.stderr?.trim() || result.error?.message}`,
    );
  }
  return path;
}

/** Writes a path for a single-quoted filter option: forward slashes, drive colon escaped. */
function quoteFilterPath(path) {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "");
}

/** Arial on Windows, where FFmpeg has no fontconfig default; elsewhere fontconfig decides. */
export function labelFontFile() {
  if (process.platform !== "win32") return undefined;
  const windir = process.env.WINDIR || "C:\\Windows";
  return join(windir, "Fonts", "arial.ttf");
}

function readOption(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const directory = readOption(
    "--out",
    join(repoRoot, "data", "krazimorph", "fixtures"),
  );
  const seconds = Number(readOption("--seconds", "90"));
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  for (const fixture of FIXTURES) {
    process.stdout.write(`${fixture.file} ... `);
    const startedAt = performance.now();
    generateFixture(fixture, directory, seconds, labelFontFile());
    process.stdout.write(
      `${((performance.now() - startedAt) / 1000).toFixed(1)}s\n`,
    );
  }
  process.stdout.write(`\nFixtures in ${directory}\n`);
}
