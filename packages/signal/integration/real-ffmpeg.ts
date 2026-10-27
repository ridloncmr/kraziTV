// Real-FFmpeg helpers shared by this package's opt-in integration suites; nothing under src/ imports them.
import { spawnSync } from "node:child_process";

import {
  createChannelStreamManager,
  createFfmpegSignalPackager,
  type ChannelStreamManagerContract,
  type CurrentPlayoutResult,
  type SelectedPlayoutItem,
  type SystemRuntime,
} from "../src/index.js";
import type { FakePlayoutProvider } from "../src/testing/fake-playout-provider.js";
import type { InMemoryTransitionCoordinator } from "../src/testing/in-memory-transition-coordinator.js";
import { ScriptedAuthorization } from "../src/testing/scripted-authorization.js";

type SelectedProgram = Extract<SelectedPlayoutItem, { kind: "program" }>;

/** The FFmpeg the suites run: `FFMPEG_PATH`, else the one on PATH. */
export const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

/** The one channel the broadcast suites tune. */
export const CHANNEL = "69";

/** A logger that says nothing, so the suites' output is FFmpeg's alone. */
export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

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

/** A program as kraziBrain selects it, airing from its media's start. */
export function program(
  scheduleEntryId: string,
  mediaPath: string,
  startsAt: number,
  durationMs: number,
  overrides: Partial<SelectedProgram> = {},
): SelectedProgram {
  return {
    kind: "program",
    channelId: CHANNEL,
    scheduleEntryId,
    scheduleRevision: 7,
    mediaItemId: `media-${scheduleEntryId}`,
    mediaPath,
    hasAudio: true,
    hasVideo: true,
    title: scheduleEntryId,
    startsAt,
    endsAt: startsAt + durationMs,
    durationMs,
    startOffsetMs: 0,
    ...overrides,
  };
}

/** What airs at `evaluatedAt`, joined at its offset. */
export function current(
  item: SelectedProgram,
  evaluatedAt: number,
): CurrentPlayoutResult {
  return {
    status: "current",
    channelId: CHANNEL,
    scheduleRevision: item.scheduleRevision,
    evaluatedAt,
    mediaOffsetMs: evaluatedAt - item.startsAt,
    item,
  };
}

/**
 * Composes the production manager over the real FFmpeg packager on the wall
 * clock, with every channel enabled and generous budgets, so a suite varies
 * only its schedule and its prepare lead.
 */
export function startManager(
  runtime: SystemRuntime,
  options: {
    provider: FakePlayoutProvider;
    coordinator: InMemoryTransitionCoordinator;
    prepareLeadMs: number;
  },
): ChannelStreamManagerContract {
  return createChannelStreamManager({
    authorization: new ScriptedAuthorization(),
    playoutProvider: options.provider,
    packager: createFfmpegSignalPackager({
      ffmpegPath,
      logger: silentLogger,
      timers: runtime,
      clock: runtime,
      terminationGraceMs: 5_000,
      itemReadinessTimeoutMs: 15_000,
    }),
    clock: runtime,
    timers: runtime,
    transitionCoordinator: options.coordinator,
    prepareLeadMs: options.prepareLeadMs,
    startupTimeoutMs: 15_000,
    recoveryTimeoutMs: 15_000,
    subscriberBufferLimitBytes: 64 * 1024 * 1024,
    retentionLimitBytes: 4 * 1024 * 1024,
    idleGraceMs: 1_000,
    logger: silentLogger,
  });
}
