import { resolve } from "node:path";

import {
  defaultTestAssetDirectory,
  generateTestAssets,
} from "./test-assets.js";

const outputDirectory = resolve(
  process.env.KRAZITV_SPIKE_ASSET_DIRECTORY ?? defaultTestAssetDirectory(),
);
const ffmpegPath = process.env.KRAZITV_SPIKE_FFMPEG_PATH ?? "ffmpeg";
const fontPath =
  process.env.KRAZITV_SPIKE_FONT_PATH ??
  (process.platform === "win32" ? "C:\\Windows\\Fonts\\arial.ttf" : undefined);
const durationSeconds = 30;

await generateTestAssets(ffmpegPath, [
  {
    label: "VIDEO A",
    color: "blue",
    toneHz: 440,
    durationSeconds,
    outputPath: resolve(outputDirectory, "video-a.mp4"),
    ...(fontPath === undefined ? {} : { fontPath }),
  },
  {
    label: "VIDEO B",
    color: "red",
    toneHz: 660,
    durationSeconds,
    outputPath: resolve(outputDirectory, "video-b.mp4"),
    ...(fontPath === undefined ? {} : { fontPath }),
  },
]);

process.stdout.write(
  [
    "Generated deterministic spike assets:",
    `KRAZITV_SPIKE_MEDIA_A_PATH=${resolve(outputDirectory, "video-a.mp4")}`,
    `KRAZITV_SPIKE_MEDIA_B_PATH=${resolve(outputDirectory, "video-b.mp4")}`,
    "",
  ].join("\n"),
);
