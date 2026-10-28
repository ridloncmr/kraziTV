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

/** The airing program's media and stored airtime. */
const PROGRAM_MS = 8_000;
/** The cut, measured from the program's start: well inside its media. */
const CUT_MS = 3_000;
const SPECIAL_MS = 10_000;
/** Long enough past the cut for the next FFmpeg process to start under load. */
const CAPTURE_MS = 10_000;

let fixtureDirectory: string;
let programPath: string;
let specialPath: string;

beforeAll(async () => {
  runFfmpeg(["-version"], "FFmpeg is required for test:ffmpeg");
  fixtureDirectory = await mkdtemp(join(tmpdir(), "krazitv-cut-"));
  // A bright pattern cut into black, both toned, so black can only mean the
  // special is on and silence can only mean a gap in the signal.
  programPath = join(fixtureDirectory, "program.mkv");
  runFfmpeg(
    [
      ...["-y", "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=8"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=8"],
      ...["-c:v", "libx264", "-c:a", "aac", programPath],
    ],
    "FFmpeg could not generate the program fixture",
  );
  specialPath = join(fixtureDirectory, "special.mkv");
  runFfmpeg(
    [
      ...["-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:r=30:d=10"],
      ...["-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:d=10"],
      ...["-c:v", "libx264", "-c:a", "aac", specialPath],
    ],
    "FFmpeg could not generate the special fixture",
  );
});

afterAll(async () => {
  if (fixtureDirectory !== undefined) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

describe("real FFmpeg cut", () => {
  it("cuts a program mid-media into the special on one session without dropping the viewer", async () => {
    const runtime = new SystemRuntime();
    const startsAt = runtime.now();
    const cutAt = startsAt + CUT_MS;
    const airing = program("program", programPath, startsAt, PROGRAM_MS);
    const cutProgram = { ...airing, scheduleRevision: 8, endsAt: cutAt };
    const special = program("special", specialPath, cutAt, SPECIAL_MS, {
      scheduleRevision: 8,
    });

    const provider = new FakePlayoutProvider();
    provider.enqueueCurrent(current(airing, startsAt));
    provider.enqueueCurrent(current(airing, startsAt));
    const coordinator = new InMemoryTransitionCoordinator(runtime);
    coordinator.setSchedule(CHANNEL, 7, [airing]);
    const manager = startManager(runtime, {
      provider,
      coordinator,
      prepareLeadMs: 1_000,
    });

    const subscription = await manager.subscribe(CHANNEL);
    const tunedAt = runtime.now();
    const chunks: Buffer[] = [];
    const arrivals: number[] = [];
    let closed = false;
    subscription.stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      arrivals.push(runtime.now());
    });
    subscription.stream.on("close", () => (closed = true));

    // The owner saves an interrupting special starting at the cut.
    await wait(Math.max(0, startsAt + 1_000 - runtime.now()));
    coordinator.setSchedule(CHANNEL, 8, [cutProgram, special]);
    provider.enqueueCurrent(current(cutProgram, runtime.now()));
    provider.enqueueFollowing({
      status: "selected",
      channelId: CHANNEL,
      scheduleRevision: 8,
      items: [special],
    });
    manager.scheduleChanged(CHANNEL);

    await wait(startsAt + CAPTURE_MS - runtime.now());
    expect(closed).toBe(false);
    expect(coordinator.calls.map((call) => call.candidate.cursor)).toEqual([
      { kind: "program", scheduleEntryId: "special" },
    ]);
    const committedAt = coordinator.calls[0]?.atMs ?? Number.NaN;
    expect(Math.abs(committedAt - cutAt)).toBeLessThan(1_000);
    subscription.close();
    await manager.shutdown();

    // The viewer kept receiving the special after the cut. A cut learned
    // inside the prepare lead still pays the next FFmpeg process's startup
    // once (ADR 0016), so delivery resumes a little after the cut.
    expect(arrivals.some((at) => at > cutAt + 1_000)).toBe(true);

    const analysis = runFfmpeg(
      [
        ...["-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0"],
        ...["-vf", "blackdetect=d=1:pix_th=0.05"],
        ...["-af", "silencedetect=d=0.5", "-f", "null", "-"],
      ],
      "FFmpeg could not decode the cut capture",
      Buffer.concat(chunks),
    );
    // The special's black starts at the cut on the stream's own timeline,
    // which began about when the viewer tuned in, and lasts to the capture's
    // end: the program never resumed.
    const black = /black_start:([\d.]+) black_end:([\d.]+)/.exec(analysis);
    expect(black, analysis).not.toBeNull();
    const [blackStart, blackEnd] = [Number(black?.[1]), Number(black?.[2])];
    expect(Math.abs(blackStart - (cutAt - tunedAt) / 1_000)).toBeLessThan(1);
    const decodedEnd = /time=(\d+):(\d+):([\d.]+)/g;
    const times = [...analysis.matchAll(decodedEnd)].at(-1);
    expect(times, analysis).toBeDefined();
    const endS =
      Number(times?.[1]) * 3_600 + Number(times?.[2]) * 60 + Number(times?.[3]);
    expect(endS - blackEnd).toBeLessThan(0.2);
    // The old FFmpeg process's unfinished frame was dropped, not spliced in.
    expectCleanDecode(analysis);
    // Tone on both sides of the cut: the timeline has no hole.
    expect(analysis).not.toMatch(/silence_start/);
  }, 45_000);
});
