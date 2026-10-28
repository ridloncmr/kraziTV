import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SystemRuntime } from "../src/index.js";
import { FakePlayoutProvider } from "../src/testing/fake-playout-provider.js";
import { InMemoryTransitionCoordinator } from "../src/testing/in-memory-transition-coordinator.js";
import {
  CHANNEL,
  current,
  program,
  runFfmpeg,
  startManager,
  wait,
} from "./real-ffmpeg.js";

const ITEM_MS = 8_000;
const PREPARE_LEAD_MS = 3_000;
/**
 * The longest pause a viewer may see while a stand-in's cold FFmpeg starts.
 * Plex waits far longer before giving up on a tuner, so this proves the
 * viewer never needs to tune again.
 */
const RECOVERY_GAP_CEILING_MS = 2_500;
/** What the stand-in's drawtext filter writes, which names its process. */
const STAND_IN_MARKER = "Programming offline";

let fixtureDirectory: string;
let episodePath: string;
let nextPath: string;
let afterPath: string;

beforeAll(async () => {
  runFfmpeg(["-version"], "FFmpeg is required for test:ffmpeg");
  fixtureDirectory = await mkdtemp(join(tmpdir(), "krazitv-killed-ffmpeg-"));
  // Toned throughout, so the stand-in's silence is the only silence. Each
  // program gets its own copy so its FFmpeg process can be found by path.
  episodePath = join(fixtureDirectory, "episode.mkv");
  runFfmpeg(
    [
      ...["-y", "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=8"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=8"],
      ...["-c:v", "libx264", "-c:a", "aac", episodePath],
    ],
    "FFmpeg could not generate the episode fixture",
  );
  nextPath = join(fixtureDirectory, "next.mkv");
  afterPath = join(fixtureDirectory, "after.mkv");
  await copyFile(episodePath, nextPath);
  await copyFile(episodePath, afterPath);
});

afterAll(async () => {
  if (fixtureDirectory !== undefined) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

/**
 * Lists this test process's direct children whose command line contains
 * `marker`. `ps` is the one portable view of another process's arguments on
 * Linux and macOS; the packager exposes no process IDs, by design.
 */
function childrenMatching(marker: string): number[] {
  const listing = execFileSync("ps", ["-ww", "-A", "-o", "pid=,ppid=,args="], {
    encoding: "utf8",
  });
  return listing
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null)
    .filter(
      ([, , ppid, args]) =>
        Number(ppid) === process.pid && args?.includes(marker),
    )
    .map(([, pid]) => Number(pid));
}

/** Kills the one FFmpeg child encoding `mediaPath`, as the OOM killer would. */
function killFfmpegFor(mediaPath: string): number {
  const pids = childrenMatching(mediaPath);
  expect(pids, `one FFmpeg process for ${mediaPath}`).toHaveLength(1);
  const pid = pids[0] ?? Number.NaN;
  process.kill(pid, "SIGKILL");
  return pid;
}

/** Waits until `condition` holds, failing after `timeoutMs`. */
async function waitUntil(
  condition: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Condition never held");
    await wait(20);
  }
}

/** The longest pause between chunk arrivals inside `[from, to]`. */
function longestGapMs(
  arrivals: readonly number[],
  from: number,
  to: number,
): number {
  const inside = arrivals.filter((at) => at >= from && at <= to);
  expect(inside.length).toBeGreaterThan(2);
  let longest = 0;
  for (let index = 1; index < inside.length; index += 1) {
    longest = Math.max(
      longest,
      (inside[index] ?? 0) - (inside[index - 1] ?? 0),
    );
  }
  return longest;
}

/**
 * Tunes one viewer to a channel airing episode, next, and after, each one
 * toned 8-second program, and records every chunk and when it arrived.
 */
async function tuneViewer() {
  const runtime = new SystemRuntime();
  const startsAt = runtime.now();
  const episode = program("episode", episodePath, startsAt, ITEM_MS);
  const next = program("next", nextPath, startsAt + ITEM_MS, ITEM_MS);
  const after = program("after", afterPath, startsAt + 2 * ITEM_MS, ITEM_MS);

  const provider = new FakePlayoutProvider();
  provider.enqueueCurrent(current(episode, startsAt));
  provider.enqueueCurrent(current(episode, startsAt));
  for (const item of [next, after]) {
    provider.enqueueFollowing({
      status: "selected",
      channelId: CHANNEL,
      scheduleRevision: 7,
      items: [item],
    });
  }
  const coordinator = new InMemoryTransitionCoordinator(runtime);
  coordinator.setSchedule(CHANNEL, 7, [episode, next, after]);
  const manager = startManager(runtime, {
    provider,
    coordinator,
    prepareLeadMs: PREPARE_LEAD_MS,
  });

  const subscription = await manager.subscribe(CHANNEL);
  const chunks: Buffer[] = [];
  const arrivals: number[] = [];
  const viewer = { closed: false };
  subscription.stream.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
    arrivals.push(runtime.now());
  });
  subscription.stream.on("close", () => (viewer.closed = true));

  return {
    runtime,
    startsAt,
    coordinator,
    chunks,
    arrivals,
    viewer,
    /** Waits until `offsetMs` after the episode's start. */
    async until(offsetMs: number): Promise<void> {
      await wait(startsAt + offsetMs - runtime.now());
    },
    /** The cursors the worker committed, in order. */
    committed() {
      return coordinator.calls.map((call) => call.candidate.cursor);
    },
    /**
     * Ends the viewer and the channel, then proves no FFmpeg child outlived
     * them: neither a program's process nor a stand-in.
     */
    async finish(): Promise<void> {
      subscription.close();
      await manager.shutdown();
      expect(childrenMatching(fixtureDirectory)).toEqual([]);
      expect(childrenMatching(STAND_IN_MARKER)).toEqual([]);
    },
  };
}

/**
 * Decodes a capture, failing on any corrupt frame, and returns the length
 * of each silence in seconds. An abrupt kill can cut FFmpeg's output inside
 * a transport packet; the splice into the stand-in must still decode.
 *
 * Timestamp warnings are not failures: every FFmpeg process starts its
 * timestamps afresh and splices rewrite only continuity counters, so the
 * decoder reports each backward jump, and a short one after a briefly aired
 * item can misplace a frame. A clean boundary into a stand-in shows the same.
 */
function silences(chunks: readonly Buffer[]): number[] {
  const analysis = runFfmpeg(
    [
      ...["-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0"],
      ...["-af", "silencedetect=d=1", "-f", "null", "-"],
    ],
    "FFmpeg could not decode the killed-FFmpeg capture",
    Buffer.concat(chunks),
  );
  expect(analysis).not.toMatch(/corrupt/i);
  expect(analysis.match(/silence_start/g)?.length ?? 0).toBe(
    analysis.match(/silence_end/g)?.length ?? 0,
  );
  return [...analysis.matchAll(/silence_duration: ([\d.]+)/g)].map((match) =>
    Number(match[1]),
  );
}

describe("real FFmpeg killed mid-broadcast", () => {
  it("airs the stand-in for the rest of an episode whose FFmpeg was killed halfway, then the next program", async () => {
    const channel = await tuneViewer();

    await channel.until(ITEM_MS / 2);
    const killedAt = channel.runtime.now();
    const killed = killFfmpegFor(episodePath);
    await waitUntil(
      () => childrenMatching(STAND_IN_MARKER).length === 1,
      3_000,
    );
    expect(childrenMatching(episodePath)).not.toContain(killed);

    await channel.until(ITEM_MS + 3_000);
    expect(channel.viewer.closed).toBe(false);
    expect(channel.committed()).toEqual([
      { kind: "program", scheduleEntryId: "next" },
    ]);
    // The next commit replaced the stand-in, so it no longer runs.
    expect(childrenMatching(STAND_IN_MARKER)).toEqual([]);
    expect(
      longestGapMs(channel.arrivals, killedAt - 1_000, killedAt + 3_000),
    ).toBeLessThan(RECOVERY_GAP_CEILING_MS);
    await channel.finish();

    // Tone, then the stand-in's silence across the episode's second half,
    // then tone from the next program, all in one decodable stream.
    const [silence, ...others] = silences(channel.chunks);
    expect(others).toEqual([]);
    expect(silence).toBeGreaterThan(2.5);
    expect(silence).toBeLessThan(5.5);
  }, 45_000);

  it("airs the stand-in at the boundary when the held next process is killed before it", async () => {
    const channel = await tuneViewer();

    // The next program's process is prepared, its output held, a second
    // before its boundary.
    await channel.until(ITEM_MS - 1_000);
    killFfmpegFor(nextPath);

    await channel.until(ITEM_MS + 2_000);
    expect(channel.viewer.closed).toBe(false);
    expect(channel.committed()).toEqual([
      { kind: "program", scheduleEntryId: "next" },
    ]);
    expect(childrenMatching(STAND_IN_MARKER)).toHaveLength(1);
    const boundaryAt = channel.startsAt + ITEM_MS;
    expect(
      longestGapMs(channel.arrivals, boundaryAt - 2_000, boundaryAt + 2_000),
    ).toBeLessThan(RECOVERY_GAP_CEILING_MS);

    await channel.until(2 * ITEM_MS + 3_000);
    expect(channel.viewer.closed).toBe(false);
    expect(channel.committed()).toEqual([
      { kind: "program", scheduleEntryId: "next" },
      { kind: "program", scheduleEntryId: "after" },
    ]);
    await channel.finish();

    // The killed program never aired: the stand-in filled its whole slot.
    const [silence, ...others] = silences(channel.chunks);
    expect(others).toEqual([]);
    expect(silence).toBeGreaterThan(6.5);
    expect(silence).toBeLessThan(9.5);
  }, 45_000);

  it("airs the stand-in when the next program's process is killed just after its commit", async () => {
    const channel = await tuneViewer();

    // Kill it inside the swap: the previous process may still be stopping
    // and the committed one has only just begun to air.
    await waitUntil(
      () => channel.coordinator.calls.length === 1,
      ITEM_MS + 3_000,
    );
    const killedAt = channel.runtime.now();
    killFfmpegFor(nextPath);
    await waitUntil(
      () => childrenMatching(STAND_IN_MARKER).length === 1,
      3_000,
    );

    await channel.until(2 * ITEM_MS + 3_000);
    expect(channel.viewer.closed).toBe(false);
    expect(channel.committed()).toEqual([
      { kind: "program", scheduleEntryId: "next" },
      { kind: "program", scheduleEntryId: "after" },
    ]);
    expect(
      longestGapMs(channel.arrivals, killedAt - 1_000, killedAt + 3_000),
    ).toBeLessThan(RECOVERY_GAP_CEILING_MS);
    await channel.finish();

    const [silence, ...others] = silences(channel.chunks);
    expect(others).toEqual([]);
    expect(silence).toBeGreaterThan(6.5);
    expect(silence).toBeLessThan(9.5);
  }, 45_000);
});
