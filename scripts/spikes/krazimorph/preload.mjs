// Node preload that rewrites the FFmpeg argv the packager spawns, in the
// server's own process, so the spike runs the real worker, session, splice,
// tuner routes, and TV program with no production code changed.
//
//   node --import ./scripts/spikes/krazimorph/preload.mjs apps/server/dist/index.js
//
// Settings, all optional:
//   KRAZIMORPH_MODE     off | native | auto     (default auto)
//   KRAZIMORPH_CEILING  480 | 720 | 1080        (default 1080)
//   KRAZIMORPH_LOG      a file every decision is appended to as one JSON line
//
// Every decision is also written to stderr as a `krazimorph` line.

import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

import { probeVideoFacts } from "./probe-facts.mjs";
import { rewriteFfmpegArguments } from "./rewrite-arguments.mjs";

const settings = {
  mode: process.env.KRAZIMORPH_MODE?.trim() || "auto",
  ceiling: Number(process.env.KRAZIMORPH_CEILING?.trim() || "1080"),
  logFile: process.env.KRAZIMORPH_LOG?.trim() || undefined,
};

const listeners = new Set();

/** Lets an in-process harness receive each decision as it is made. */
export function onDecision(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The settings this preload read, for harness reports. */
export function spikeSettings() {
  return { ...settings };
}

const realSpawn = childProcess.spawn;

/** Rewrites FFmpeg commands only; any failure here falls back to the original argv. */
function spikeSpawn(command, args, options) {
  if (!Array.isArray(args) || !isFfmpeg(command)) {
    return realSpawn.call(childProcess, command, args, options);
  }
  let rewritten = args;
  try {
    const result = rewriteFfmpegArguments(args, {
      mode: settings.mode,
      ceiling: settings.ceiling,
      probe: probeVideoFacts,
    });
    rewritten = result.args;
    if (result.decision !== undefined) report(result.decision, rewritten);
  } catch (error) {
    report({ error: error instanceof Error ? error.message : String(error) });
  }
  return realSpawn.call(childProcess, command, rewritten, options);
}

function isFfmpeg(command) {
  return /^ffmpeg(\.exe)?$/i.test(basename(String(command)));
}

/** One decision as a log line: the file by name only, never its folder. */
function report(decision, args) {
  const line = {
    event: "krazimorph_decision",
    mode: settings.mode,
    ceiling: settings.ceiling,
    ...(decision.error !== undefined
      ? { error: decision.error }
      : {
          file: basename(decision.mediaPath),
          strategy: decision.plan.strategy,
          reasons: decision.plan.reasons,
          output: decision.plan.video,
          request: {
            offsetMs: decision.request.offsetMs,
            startsSession: decision.request.startsSession,
            blackTail: decision.request.blackTail,
          },
          source: decision.facts?.unknown
            ? { unknown: true, probeMs: decision.facts.probeMs }
            : {
                codec: decision.facts.codec,
                profile: decision.facts.profile,
                size: `${decision.facts.width}x${decision.facts.height}`,
                pixelFormat: decision.facts.pixelFormat,
                fieldOrder: decision.facts.fieldOrder,
                frameRate: decision.facts.frameRate?.text,
                sampleAspectRatio: decision.facts.sampleAspectRatio,
                probeMs: decision.facts.probeMs,
              },
        }),
  };
  const text = JSON.stringify(line);
  process.stderr.write(`krazimorph ${text}\n`);
  if (settings.logFile) {
    try {
      appendFileSync(settings.logFile, `${text}\n`);
    } catch {
      // A missing log folder must never stop a broadcast.
    }
  }
  for (const listener of listeners) listener(line, args);
}

childProcess.spawn = spikeSpawn;
// The packager imports `spawn` as a named ESM binding; this updates it.
syncBuiltinESMExports();
process.stderr.write(
  `krazimorph preload active: mode=${settings.mode} ceiling=${settings.ceiling}p\n`,
);
