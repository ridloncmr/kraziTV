// Runs the production channel stream manager, worker, session, and splice
// over the real FFmpeg against a fixed four-item schedule, with the preload
// rewriting argv the way the server run would, then decodes the capture and
// reports what changed at each splice. No Plex, no browser: this answers the
// decoder-level questions first.
//
// Usage:
//   npm run build:node
//   KRAZIMORPH_MODE=auto node scripts/spikes/krazimorph/local-splice.mjs
//
// Writes data/krazimorph/local/capture-<mode>.ts for playback in VLC, ffplay,
// or any player that takes a transport stream.

import { onDecision, spikeSettings } from "./preload.mjs";

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createChannelStreamManager,
  createFfmpegSignalPackager,
  defaultFillerFontFile,
  SystemRuntime,
} from "../../../packages/signal/dist/index.js";
import {
  FIXTURES,
  ffmpegPath,
  generateFixture,
  labelFontFile,
  repoRoot,
} from "./make-fixtures.mjs";

const CHANNEL = "69";
const ITEM_MS = 12_000;
/** The order the items air: encode first, then copy, encode, copy. */
const SEQUENCE = ["KM-A", "KM-B", "KM-C", "KM-E"];
const PREPARE_LEAD_MS = 3_000;
const CAPTURE_MS = SEQUENCE.length * ITEM_MS - 2_000;

const outputDirectory = join(repoRoot, "data", "krazimorph", "local");
const fixtureDirectory = join(outputDirectory, `fixtures-${ITEM_MS / 1000}s`);
mkdirSync(fixtureDirectory, { recursive: true });

const settings = spikeSettings();
const decisions = [];
onDecision((line) => decisions.push(line));

const fixtures = SEQUENCE.map((prefix) => {
  const fixture = FIXTURES.find((candidate) =>
    candidate.name.startsWith(prefix),
  );
  const path = join(fixtureDirectory, fixture.file);
  if (!existsSync(path)) {
    process.stdout.write(`making ${fixture.file}\n`);
    generateFixture(fixture, fixtureDirectory, ITEM_MS / 1000, labelFontFile());
  }
  return { ...fixture, path };
});

const runtime = new SystemRuntime();
const startsAt = runtime.now();
const items = fixtures.map((fixture, index) => ({
  kind: "program",
  channelId: CHANNEL,
  scheduleEntryId: fixture.file,
  scheduleRevision: 1,
  mediaItemId: `media-${index}`,
  mediaPath: fixture.path,
  hasAudio: true,
  hasVideo: true,
  title: fixture.name,
  startsAt: startsAt + index * ITEM_MS,
  endsAt: startsAt + (index + 1) * ITEM_MS,
  durationMs: ITEM_MS,
  startOffsetMs: 0,
}));

/** Answers playout from the fixed sequence; every item is current while it airs. */
const provider = {
  async getCurrent(channelId, atMs) {
    const item = items.find(
      (candidate) => atMs >= candidate.startsAt && atMs < candidate.endsAt,
    );
    if (item === undefined) {
      return {
        status: "no_current",
        channelId,
        scheduleRevision: 1,
        evaluatedAt: atMs,
        reason: "schedule_gap",
      };
    }
    return {
      status: "current",
      channelId,
      scheduleRevision: 1,
      evaluatedAt: atMs,
      mediaOffsetMs: atMs - item.startsAt,
      item,
    };
  },
  async getFollowing(channelId, after, count) {
    const index = items.findIndex(
      (candidate) => candidate.scheduleEntryId === after.scheduleEntryId,
    );
    if (index === -1)
      return {
        status: "stale_entry",
        channelId,
        scheduleRevision: 1,
        items: [],
      };
    return {
      status: "selected",
      channelId,
      scheduleRevision: 1,
      items: items.slice(index + 1, index + 1 + count),
    };
  },
};

const logger = {
  debug() {},
  info() {},
  warn: (event, context) =>
    process.stderr.write(`signal warn ${event} ${JSON.stringify(context)}\n`),
  error: (event, context) =>
    process.stderr.write(`signal error ${event} ${JSON.stringify(context)}\n`),
};

const manager = createChannelStreamManager({
  authorization: {
    async getChannelAuthorization(channelId) {
      return { status: "enabled", channelId };
    },
  },
  playoutProvider: provider,
  packager: createFfmpegSignalPackager({
    ffmpegPath,
    logger,
    timers: runtime,
    clock: runtime,
    terminationGraceMs: 5_000,
    itemReadinessTimeoutMs: 15_000,
    fillerFontFile: defaultFillerFontFile(process.platform, process.env.WINDIR),
  }),
  clock: runtime,
  timers: runtime,
  // The schedule never changes here, so every prepared item commits.
  transitionCoordinator: {
    async commitPreparedTransition(_candidate, commit) {
      commit();
      return "committed";
    },
  },
  prepareLeadMs: PREPARE_LEAD_MS,
  startupTimeoutMs: 15_000,
  recoveryTimeoutMs: 15_000,
  subscriberBufferLimitBytes: 64 * 1024 * 1024,
  retentionLimitBytes: 16 * 1024 * 1024,
  idleGraceMs: 1_000,
  logger,
});

process.stdout.write(
  `\nkraziMorph local splice: mode=${settings.mode} ceiling=${settings.ceiling}p\n`,
);
process.stdout.write(
  `sequence: ${fixtures.map((fixture) => fixture.name).join("  ->  ")}\n\n`,
);

/** Viewers that tune in part-way through a copied item, to measure the join backlog. */
const lateJoins = [
  { label: "mid KM-B (copied, 5 s GOP)", at: startsAt + ITEM_MS * 1.5 },
  { label: "mid KM-E (copied, 60 fps)", at: startsAt + ITEM_MS * 3.5 },
];
/** How long a late viewer stays attached; the replay arrives at once. */
const LATE_CAPTURE_MS = 1_500;

const subscription = await manager.subscribe(CHANNEL);
const chunks = [];
const arrivals = [];
subscription.stream.on("data", (chunk) => {
  chunks.push(chunk);
  arrivals.push(runtime.now());
});
let ended;
subscription.stream.on("close", () => (ended = runtime.now()));

const lateResults = lateJoins.map(
  (join) =>
    new Promise((resolve) => {
      setTimeout(async () => {
        const joinedAt = runtime.now();
        const late = await manager.subscribe(CHANNEL);
        const lateChunks = [];
        let firstChunkAt;
        late.stream.on("data", (chunk) => {
          firstChunkAt ??= runtime.now();
          lateChunks.push(chunk);
        });
        setTimeout(() => {
          late.close();
          resolve({
            ...join,
            joinedAt,
            firstChunkDelayMs:
              firstChunkAt === undefined ? undefined : firstChunkAt - joinedAt,
            capture: Buffer.concat(lateChunks),
          });
        }, LATE_CAPTURE_MS);
      }, join.at - runtime.now());
    }),
);

await new Promise((resolve) =>
  setTimeout(resolve, startsAt + CAPTURE_MS - runtime.now()),
);
const lateViewers = await Promise.all(lateResults);
subscription.close();
await manager.shutdown();

const capture = Buffer.concat(chunks);
const capturePath = join(outputDirectory, `capture-${settings.mode}.ts`);
writeFileSync(capturePath, capture);

/**
 * Decodes a capture once. `showinfo` names each frame's size,
 * `silencedetect` turns a hole in the audio into a line, and passthrough
 * timing on a 90 kHz output timebase keeps the analyzer from inventing
 * duplicate timestamps when the frame rate changes.
 */
function decodeReport(path) {
  const log = spawnSync(
    ffmpegPath,
    [
      ...["-hide_banner", "-i", path],
      ...["-fps_mode", "passthrough", "-enc_time_base", "1/90000"],
      ...["-vf", "showinfo", "-af", "silencedetect=d=0.5", "-f", "null", "-"],
    ],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
    },
  ).stderr;
  const sizes = [];
  for (const match of log.matchAll(/showinfo.*? s:(\d+x\d+)/g)) {
    if (sizes.at(-1) !== match[1]) sizes.push(match[1]);
  }
  const count = (pattern) => (log.match(pattern) ?? []).length;
  const noise =
    /showinfo|^Input #|^Output #|^\s*Stream #|^\s*Metadata|^\s*Duration|^Press|^frame=|^\s*encoder|^Stream mapping|^\[out#|^\s*$|^\s{4}/;
  const categories = new Map();
  for (const line of log.split("\n")) {
    if (noise.test(line)) continue;
    const key = line.replace(/0x[0-9a-f]+|\d+/g, "N");
    categories.set(key, (categories.get(key) ?? 0) + 1);
  }
  return {
    sizes,
    corrupt: count(/corrupt/gi),
    backward: count(/out of order|non monoton|timestamp discontinuity/gi),
    silences: count(/silence_start/g),
    categories: [...categories.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/** The packets of one stream as the transport stream carries them. */
function packets(path, stream) {
  const csv = spawnSync(
    process.env.FFPROBE_PATH?.trim() || "ffprobe",
    [
      ...["-v", "error", "-select_streams", stream],
      ...["-show_entries", "packet=pts,dts,flags", "-of", "csv=p=0", path],
    ],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  ).stdout;
  return csv
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [pts, dts, flags] = line.split(",");
      return { pts: Number(pts), dts: Number(dts), key: flags.includes("K") };
    });
}

/** How many times DTS failed to increase, and the largest step, in ms. */
function dtsReport(list) {
  let previous;
  let regressions = 0;
  let largestStepMs = 0;
  for (const packet of list) {
    if (Number.isNaN(packet.dts)) continue;
    if (previous !== undefined) {
      if (packet.dts <= previous) regressions += 1;
      largestStepMs = Math.max(largestStepMs, (packet.dts - previous) / 90);
    }
    previous = packet.dts;
  }
  return { regressions, largestStepMs: Math.round(largestStepMs) };
}

const main = decodeReport(capturePath);
const video = packets(capturePath, "v");
const audio = packets(capturePath, "a");

process.stdout.write("decisions\n");
for (const decision of decisions) {
  process.stdout.write(
    `  ${decision.file ?? "?"}: ${decision.strategy}${decision.output ? ` ${decision.output.width}x${decision.output.height} @ ${decision.output.frameRate}` : ""}\n`,
  );
  for (const reason of decision.reasons ?? [])
    process.stdout.write(`      - ${reason}\n`);
  if (decision.error) process.stdout.write(`      ! ${decision.error}\n`);
}

process.stdout.write("\nsplices\n");
for (let index = 1; index < items.length; index += 1) {
  const boundaryAt = items[index].startsAt;
  const around = arrivals.filter(
    (at) => at >= boundaryAt - 1_000 && at <= boundaryAt + 3_000,
  );
  let longestGapMs = 0;
  for (let at = 1; at < around.length; at += 1) {
    longestGapMs = Math.max(longestGapMs, around[at] - around[at - 1]);
  }
  process.stdout.write(
    `  ${items[index - 1].title}  ->  ${items[index].title}: longest delivery gap ${longestGapMs} ms over ${around.length} chunks\n`,
  );
}

process.stdout.write("\ntransport stream\n");
const videoDts = dtsReport(video);
const audioDts = dtsReport(audio);
process.stdout.write(
  `  video: ${video.length} packets, ${video.filter((packet) => packet.key).length} keyframes, DTS regressions ${videoDts.regressions}, largest DTS step ${videoDts.largestStepMs} ms\n`,
);
process.stdout.write(
  `  audio: ${audio.length} packets, DTS regressions ${audioDts.regressions}, largest DTS step ${audioDts.largestStepMs} ms\n`,
);

process.stdout.write("\ndecode\n");
process.stdout.write(
  `  frame sizes in order: ${main.sizes.join(" -> ") || "none decoded"}\n`,
);
process.stdout.write(`  corrupt frames: ${main.corrupt}\n`);
process.stdout.write(
  `  backward or discontinuous timestamps: ${main.backward}\n`,
);
process.stdout.write(`  silences of 0.5 s or more: ${main.silences}\n`);
process.stdout.write(
  `  stream closed early: ${ended === undefined ? "no" : `yes, at ${ended - startsAt} ms`}\n`,
);
process.stdout.write("  decoder messages:\n");
for (const [line, times] of main.categories.slice(0, 8)) {
  process.stdout.write(`    ${times}x ${line.trim()}\n`);
}
if (main.categories.length === 0) process.stdout.write("    none\n");

process.stdout.write(
  "\nlate joins (ADR 0018 aims for about 10 s behind the live edge)\n",
);
for (const [index, viewer] of lateViewers.entries()) {
  const latePath = join(
    outputDirectory,
    `capture-${settings.mode}-late-${index + 1}.ts`,
  );
  writeFileSync(latePath, viewer.capture);
  // The live edge at the join: the last video packet the main viewer had
  // received by then. Timestamps run on one timeline (ADR 0021), so the
  // difference to the late viewer's first video packet is the replay depth.
  const prefixPath = join(outputDirectory, `prefix-${index + 1}.ts`);
  const prefixEnd = arrivals.findIndex((at) => at > viewer.joinedAt);
  writeFileSync(
    prefixPath,
    Buffer.concat(
      chunks.slice(0, prefixEnd === -1 ? chunks.length : prefixEnd),
    ),
  );
  const liveEdge = packets(prefixPath, "v").at(-1);
  const lateVideo = packets(latePath, "v");
  const first = lateVideo[0];
  const late = decodeReport(latePath);
  process.stdout.write(`  ${viewer.label}:\n`);
  if (first === undefined || liveEdge === undefined) {
    process.stdout.write("    no video received\n");
    continue;
  }
  process.stdout.write(
    `    first chunk after ${viewer.firstChunkDelayMs} ms, ${(viewer.capture.byteLength / 1024 / 1024).toFixed(2)} MiB in ${LATE_CAPTURE_MS} ms\n`,
  );
  process.stdout.write(
    `    joined ${((liveEdge.pts - first.pts) / 90_000).toFixed(1)} s behind the live edge, on a ${first.key ? "keyframe" : "non-keyframe"}\n`,
  );
  process.stdout.write(
    `    replay decodes: ${late.corrupt} corrupt frames, sizes ${late.sizes.join(" -> ")}\n`,
  );
}

process.stdout.write(
  `\ncapture: ${capturePath} (${(capture.byteLength / 1024 / 1024).toFixed(1)} MiB)\n`,
);
