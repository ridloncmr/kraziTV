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
  program,
  runFfmpeg,
  startManager,
  wait,
} from "./real-ffmpeg.js";

const ITEM_MS = 4_000;
const PREPARE_LEAD_MS = 3_000;

let fixtureDirectory: string;
let tonedPath: string;
let missingPath: string;

beforeAll(async () => {
  runFfmpeg(["-version"], "FFmpeg is required for test:ffmpeg");
  fixtureDirectory = await mkdtemp(join(tmpdir(), "krazitv-failed-item-"));
  // A toned program, so the stand-in's silence is the only silence.
  tonedPath = join(fixtureDirectory, "toned.mkv");
  runFfmpeg(
    [
      ...["-y", "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=10"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=10"],
      ...["-c:v", "libx264", "-c:a", "aac", tonedPath],
    ],
    "FFmpeg could not generate the toned fixture",
  );
  // Deleted, or on a mount that went away, since the catalog scan.
  missingPath = join(fixtureDirectory, "missing.mkv");
});

afterAll(async () => {
  if (fixtureDirectory !== undefined) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

/** Decodes a capture, failing on any corrupt frame, and returns FFmpeg's report. */
function analyze(chunks: readonly Buffer[]): string {
  const analysis = runFfmpeg(
    [
      ...["-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0"],
      ...["-vf", "signalstats,metadata=print"],
      ...["-af", "silencedetect=d=1", "-f", "null", "-"],
    ],
    "FFmpeg could not decode the failed-item capture",
    Buffer.concat(chunks),
  );
  expect(analysis).not.toMatch(/corrupt/i);
  return analysis;
}

describe("real FFmpeg failed item", () => {
  it("airs a stand-in for a missing file and carries the broadcast on to the next program", async () => {
    const runtime = new SystemRuntime();
    const startsAt = runtime.now();
    const first = program("first", tonedPath, startsAt, ITEM_MS);
    const missing = program(
      "missing",
      missingPath,
      startsAt + ITEM_MS,
      ITEM_MS,
    );
    // Long enough that its own following lookup falls after the capture.
    const third = program("third", tonedPath, startsAt + 2 * ITEM_MS, 10_000);

    const provider = new FakePlayoutProvider();
    provider.enqueueCurrent(current(first, startsAt));
    provider.enqueueCurrent(current(first, startsAt));
    for (const item of [missing, third]) {
      provider.enqueueFollowing({
        status: "selected",
        channelId: CHANNEL,
        scheduleRevision: 7,
        items: [item],
      });
    }
    const coordinator = new InMemoryTransitionCoordinator(runtime);
    coordinator.setSchedule(CHANNEL, 7, [first, missing, third]);
    const manager = startManager(runtime, {
      provider,
      coordinator,
      prepareLeadMs: PREPARE_LEAD_MS,
    });

    const subscription = await manager.subscribe(CHANNEL);
    const chunks: Buffer[] = [];
    let closed = false;
    subscription.stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    subscription.stream.on("close", () => (closed = true));

    await wait(startsAt + 2 * ITEM_MS + 3_000 - runtime.now());
    expect(closed).toBe(false);
    expect(coordinator.calls.map((call) => call.candidate.cursor)).toEqual([
      { kind: "program", scheduleEntryId: "missing" },
      { kind: "program", scheduleEntryId: "third" },
    ]);
    subscription.close();
    await manager.shutdown();

    // Tone, then the stand-in's silence across the missing program, then
    // tone again from the next program, all in one decodable stream.
    const analysis = analyze(chunks);
    expect(analysis.match(/silence_start/g)).toHaveLength(1);
    expect(analysis).toMatch(/silence_end/);
  }, 45_000);

  it("lets a viewer tune in to a stand-in when the airing program's file is missing", async () => {
    const runtime = new SystemRuntime();
    const startsAt = runtime.now();
    const missing = program("missing", missingPath, startsAt, 60_000);

    const provider = new FakePlayoutProvider();
    provider.enqueueCurrent(current(missing, startsAt));
    provider.enqueueCurrent(current(missing, startsAt));
    const coordinator = new InMemoryTransitionCoordinator(runtime);
    coordinator.setSchedule(CHANNEL, 7, [missing]);
    const manager = startManager(runtime, {
      provider,
      coordinator,
      prepareLeadMs: PREPARE_LEAD_MS,
    });

    const subscription = await manager.subscribe(CHANNEL);
    const chunks: Buffer[] = [];
    subscription.stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    await wait(3_000);
    subscription.close();
    await manager.shutdown();

    const analysis = analyze(chunks);
    expect(analysis).toMatch(/Video: h264[^\n]*1920x1080/);
    expect(analysis).toMatch(/silence_start/);
    // Mostly black, with the card's white text on every frame.
    const averages = [...analysis.matchAll(/signalstats\.YAVG=([\d.]+)/g)];
    const brightest = [...analysis.matchAll(/signalstats\.YMAX=(\d+)/g)];
    expect(brightest.length).toBeGreaterThan(30);
    expect(Math.max(...averages.map((match) => Number(match[1])))).toBeLessThan(
      40,
    );
    expect(
      Math.min(...brightest.map((match) => Number(match[1]))),
    ).toBeGreaterThan(200);
  }, 45_000);
});
