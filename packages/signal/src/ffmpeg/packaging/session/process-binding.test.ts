import { describe, expect, it } from "vitest";

import { SignalError } from "../../../errors.js";
import { FakeClock } from "../../../testing/fake-clock.js";
import {
  FakeProcess,
  FakeProcessSpawner,
} from "../../../testing/fake-process.js";
import { MarkerReadinessInspector } from "../../../testing/marker-readiness-inspector.js";
import { RecordingLogger } from "../../../testing/recording-logger.js";
import { settlePromises } from "../../../testing/settle-promises.js";
import { FfmpegProcess } from "../../process/ffmpeg-process.js";
import { ProcessBinding } from "./process-binding.js";

const READINESS_TIMEOUT_MS = 1_000;
const STALL_TIMEOUT_MS = 500;

const failureReason = (error: unknown): unknown =>
  error instanceof SignalError ? error.details["reason"] : error;

const createHarness = () => {
  const child = new FakeProcess();
  const spawner = new FakeProcessSpawner();
  const timers = new FakeClock();
  spawner.enqueue(child);
  const process = FfmpegProcess.start({
    args: ["-version"],
    spawner,
    timers,
    logger: new RecordingLogger(),
    ffmpegPath: "ffmpeg",
  });
  const events: string[] = [];
  const binding = new ProcessBinding({
    process,
    item: {
      kind: "filler",
      channelId: "channel-1",
      message: "Programming resumes at 8:00 PM",
      airtimeMs: 60_000,
    },
    standIn: false,
    held: undefined,
    output: { write: () => undefined },
    inspector: new MarkerReadinessInspector(),
    timers,
    readinessTimeoutMs: READINESS_TIMEOUT_MS,
    stallTimeoutMs: STALL_TIMEOUT_MS,
    events: {
      onReady: () => events.push("ready"),
      onExited: () => events.push("exited"),
      onFailed: (_binding, error) =>
        events.push(`failed:${String(failureReason(error))}`),
      onStalled: () => events.push("stalled"),
    },
  });
  return { child, timers, events, binding };
};

describe("ProcessBinding", () => {
  it("reports the exit before the failure when the process ends before usable output", async () => {
    const { child, timers, events } = createHarness();

    child.exit({ code: 0, signal: null });
    await settlePromises(2);
    timers.advanceBy(READINESS_TIMEOUT_MS);

    expect(events).toEqual(["exited", "failed:premature_exit"]);
  });

  it("stops its timers before reporting a readiness timeout, so nothing fires after", async () => {
    const { child, timers, events } = createHarness();

    timers.advanceBy(READINESS_TIMEOUT_MS);
    child.writeStdout("usable-output");
    await settlePromises();
    timers.advanceBy(STALL_TIMEOUT_MS);

    expect(events).toEqual(["failed:item_readiness_timeout"]);
  });

  it("keeps the stall timer of a process that exited after usable output, so early media end is caught as silence", async () => {
    const { child, timers, events } = createHarness();

    child.writeStdout("usable-output");
    await settlePromises();
    child.exit({ code: 0, signal: null });
    await settlePromises(2);
    expect(events).toEqual(["ready", "exited"]);

    timers.advanceBy(STALL_TIMEOUT_MS);
    expect(events).toEqual(["ready", "exited", "stalled"]);
  });

  it("arms no stall timer once the session stops watching it", async () => {
    const { child, timers, events, binding } = createHarness();

    child.writeStdout("usable-output");
    await settlePromises();
    binding.cancelStallWatch();
    child.writeStdout("more output");
    await settlePromises();
    timers.advanceBy(STALL_TIMEOUT_MS);

    expect(events).toEqual(["ready"]);
  });
});
