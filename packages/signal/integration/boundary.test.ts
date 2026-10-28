import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SystemRuntime } from "../src/index.js";
import { FakePlayoutProvider } from "../src/testing/fake-playout-provider.js";
import { InMemoryTransitionCoordinator } from "../src/testing/in-memory-transition-coordinator.js";
import {
  CHANNEL,
  current,
  expectCleanDecode,
  program,
  runFfmpeg,
  startManager,
  wait,
} from "./real-ffmpeg.js";

const FIRST_MS = 6_000;
const SECOND_MS = 10_000;
/** How far ahead the next FFmpeg process starts; production uses the same. */
const PREPARE_LEAD_MS = 3_000;
/** Long enough past the boundary to see the second program delivered live. */
const CAPTURE_MS = FIRST_MS + 4_000;
/** The longest pause delivery may show around the boundary (ADR 0016). */
const GAP_CEILING_MS = 700;

let fixtureDirectory: string;
let firstPath: string;
let secondPath: string;

beforeAll(async () => {
  runFfmpeg(["-version"], "FFmpeg is required for test:ffmpeg");
  fixtureDirectory = await mkdtemp(join(tmpdir(), "krazitv-boundary-"));
  // Two toned programs, so silence can only mean a hole in the signal.
  firstPath = join(fixtureDirectory, "first.mkv");
  runFfmpeg(
    [
      ...["-y", "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=6"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=6"],
      ...["-c:v", "libx264", "-c:a", "aac", firstPath],
    ],
    "FFmpeg could not generate the first fixture",
  );
  secondPath = join(fixtureDirectory, "second.mkv");
  runFfmpeg(
    [
      ...["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=30:d=10"],
      ...["-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:d=10"],
      ...["-c:v", "libx264", "-c:a", "aac", secondPath],
    ],
    "FFmpeg could not generate the second fixture",
  );
});

afterAll(async () => {
  if (fixtureDirectory !== undefined) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

describe("real FFmpeg boundary", () => {
  it("crosses a boundary known a lead ahead without pausing delivery", async () => {
    const runtime = new SystemRuntime();
    const startsAt = runtime.now();
    const boundaryAt = startsAt + FIRST_MS;
    const first = program("first", firstPath, startsAt, FIRST_MS);
    const second = program("second", secondPath, boundaryAt, SECOND_MS);

    const provider = new FakePlayoutProvider();
    provider.enqueueCurrent(current(first, startsAt));
    provider.enqueueCurrent(current(first, startsAt));
    provider.enqueueFollowing({
      status: "selected",
      channelId: CHANNEL,
      scheduleRevision: 7,
      items: [second],
    });
    const coordinator = new InMemoryTransitionCoordinator(runtime);
    coordinator.setSchedule(CHANNEL, 7, [first, second]);
    const manager = startManager(runtime, {
      provider,
      coordinator,
      prepareLeadMs: PREPARE_LEAD_MS,
    });

    const subscription = await manager.subscribe(CHANNEL);
    const chunks: Buffer[] = [];
    const arrivals: number[] = [];
    let closed = false;
    subscription.stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      arrivals.push(runtime.now());
    });
    subscription.stream.on("close", () => (closed = true));

    await wait(startsAt + CAPTURE_MS - runtime.now());
    expect(closed).toBe(false);
    expect(coordinator.calls.map((call) => call.candidate.cursor)).toEqual([
      { kind: "program", scheduleEntryId: "second" },
    ]);
    const committedAt = coordinator.calls[0]?.atMs ?? Number.NaN;
    expect(Math.abs(committedAt - boundaryAt)).toBeLessThan(1_000);
    subscription.close();
    await manager.shutdown();

    // Delivery never paused for the second process's startup: the longest
    // gap between chunks from a second before the boundary to well after it
    // stays far below the startup latency a cold process pays.
    const around = arrivals.filter(
      (at) => at >= boundaryAt - 1_000 && at <= boundaryAt + 3_000,
    );
    expect(around.length).toBeGreaterThan(2);
    let longestGapMs = 0;
    for (let index = 1; index < around.length; index += 1) {
      longestGapMs = Math.max(
        longestGapMs,
        (around[index] ?? 0) - (around[index - 1] ?? 0),
      );
    }
    expect(longestGapMs).toBeLessThan(GAP_CEILING_MS);

    const analysis = runFfmpeg(
      [
        ...["-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0"],
        ...["-af", "silencedetect=d=0.5", "-f", "null", "-"],
      ],
      "FFmpeg could not decode the boundary capture",
      Buffer.concat(chunks),
    );
    // Tone on both sides of the boundary: the timeline has no hole, and the
    // splice left no corrupt frame.
    expect(analysis).not.toMatch(/silence_start/);
    expectCleanDecode(analysis);
  }, 45_000);
});
