// Writes the demo library's placeholder videos under data/demo/media, named
// the way the wiki's "Naming your files" page recommends. Each file is a
// title card over silence. Existing files are kept, so reruns are quick.
//
// Usage:
//   node scripts/demo-library/make-media.mjs

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { movies, shows } from "./library.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mediaDir = join(repoRoot, "data", "demo", "media");
const fonts = "/usr/share/fonts/truetype/dejavu";
const colors = [
  "0x1d3557",
  "0x6a040f",
  "0x2d6a4f",
  "0x3c096c",
  "0x7f5539",
  "0x003049",
  "0x5f0f40",
];

/**
 * Renders a 10-second card once and loops it to full length by copying, so
 * an hour-long file takes seconds instead of re-encoding every frame.
 */
function makeCard(file, { heading, detail, minutes, color }) {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "krazitv-demo-"));
  try {
    // Text files avoid escaping apostrophes and colons in drawtext.
    writeFileSync(join(work, "heading.txt"), heading);
    writeFileSync(join(work, "detail.txt"), detail);
    writeFileSync(join(work, "footer.txt"), "kraziTV demo library");
    const text = (name, font, size, y, fontcolor) =>
      `drawtext=fontfile=${fonts}/${font}:textfile=${join(work, name)}:fontcolor=${fontcolor}:fontsize=${size}:x=(w-tw)/2:y=${y}`;
    const video = [
      `color=c=${color}:s=1280x720:r=24:d=10`,
      text("heading.txt", "DejaVuSans-Bold.ttf", 60, "(h-th)/2-40", "white"),
      text("detail.txt", "DejaVuSans.ttf", 34, "(h/2)+40", "0xdddddd"),
      text("footer.txt", "DejaVuSans.ttf", 22, "h-60", "0xaaaaaa"),
    ].join(",");
    const clip = join(work, "clip.mkv");
    const ffmpeg = (args) =>
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...args,
      ]);
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      video,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      "10",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "stillimage",
      "-crf",
      "28",
      "-g",
      "48",
      "-c:a",
      "aac",
      "-b:a",
      "32k",
      clip,
    ]);
    ffmpeg([
      "-stream_loop",
      "-1",
      "-i",
      clip,
      "-t",
      String(minutes * 60),
      "-c",
      "copy",
      file,
    ]);
    console.log(`made ${file.slice(mediaDir.length + 1)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

shows.forEach((show, index) => {
  const folder = join(
    mediaDir,
    "TV Shows",
    `${show.title} (${show.year})`,
    "Season 1",
  );
  for (let episode = 1; episode <= show.episodes; episode += 1) {
    const code = `S01E${String(episode).padStart(2, "0")}`;
    makeCard(join(folder, `${show.title} - ${code}.mkv`), {
      heading: show.title,
      detail: `Season 1 · Episode ${episode}`,
      minutes: show.minutes,
      color: colors[index % colors.length],
    });
  }
});

movies.forEach((movie, index) => {
  const name = `${movie.title} (${movie.year})`;
  makeCard(join(mediaDir, "Movies", name, `${name}.mkv`), {
    heading: movie.title,
    detail: String(movie.year),
    minutes: movie.minutes,
    color: colors[(index + 3) % colors.length],
  });
});
