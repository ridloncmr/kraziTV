import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFfprobeArguments } from "./ffprobe-arguments.js";
import {
  FfprobeMediaProber,
  type FfprobeMediaProberOptions,
} from "./ffprobe-media-prober.js";
import { MediaProbeError } from "./media-probe-error.js";
import { FakeProcess, FakeProcessSpawner } from "./testing/fake-process.js";

const MEDIA_PATH = "/media/Show S01E01.mkv";
const VALID_OUTPUT = JSON.stringify({
  streams: [{ codec_type: "video" }, { codec_type: "audio" }],
  format: { duration: "1320.042000" },
});
const TIMEOUT_MS = 30_000;
const GRACE_MS = 5_000;
const ONE_MIB = 1024 * 1024;

let spawner: FakeProcessSpawner;
let child: FakeProcess;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  spawner = new FakeProcessSpawner();
  child = new FakeProcess();
  spawner.enqueue(child);
});

afterEach(() => {
  vi.useRealTimers();
});

// Builds a prober wired to the fake spawner with spec-default limits.
function createProber(overrides: Partial<FfprobeMediaProberOptions> = {}) {
  return new FfprobeMediaProber({
    ffprobePath: "/opt/ffmpeg/ffprobe",
    timeoutMs: TIMEOUT_MS,
    spawner,
    ...overrides,
  });
}

// Tracks settlement so tests can assert a probe is still waiting on its child.
function track<T>(promise: Promise<T>) {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
}

// Lets stream events and promise continuations run without advancing time.
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

// Awaits a probe expected to fail and returns its typed error.
async function probeError(promise: Promise<unknown>): Promise<MediaProbeError> {
  const error = await promise.then(
    () => {
      throw new Error("Expected the probe to fail");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(MediaProbeError);
  return error as MediaProbeError;
}

describe("FfprobeMediaProber", () => {
  describe("successful probes", () => {
    it("runs the configured executable with structured arguments", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      child.exit({ code: 0, signal: null });
      await probe.catch(() => undefined);

      expect(spawner.spawnCalls).toEqual([
        {
          command: "/opt/ffmpeg/ffprobe",
          args: buildFfprobeArguments(MEDIA_PATH),
        },
      ]);
    });

    it("returns normalized metadata assembled from chunked stdout", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      child.stdout.write(VALID_OUTPUT.slice(0, 10));
      child.stdout.write(VALID_OUTPUT.slice(10));
      child.exit({ code: 0, signal: null });

      await expect(probe).resolves.toEqual({
        durationMs: 1_320_042,
        hasAudio: true,
      });
    });

    it("clears its timers and ignores cancellation once settled", async () => {
      const controller = new AbortController();
      const probe = createProber().probe(MEDIA_PATH, {
        signal: controller.signal,
      });
      child.stdout.write(VALID_OUTPUT);
      child.exit({ code: 0, signal: null });
      await probe;

      controller.abort();
      expect(vi.getTimerCount()).toBe(0);
      expect(child.terminationSignals).toEqual([]);
    });
  });

  describe("process failures", () => {
    it("reports a synchronous spawn failure", async () => {
      const failing = {
        spawn: () => {
          throw new Error("spawn EACCES");
        },
      };
      const error = await probeError(
        createProber({ spawner: failing }).probe(MEDIA_PATH),
      );

      expect(error.code).toBe("spawn_failed");
      expect(error.message).toContain("spawn EACCES");
    });

    it("reports an asynchronous spawn failure such as a missing executable", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      child.fail(
        Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" }),
      );

      const error = await probeError(probe);
      expect(error.code).toBe("spawn_failed");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("reports a non-zero exit with the last stderr line", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      child.stderr.write("[matroska] EBML header parsing failed\n");
      child.stderr.write(
        `${MEDIA_PATH}: Invalid data found when processing input\n`,
      );
      child.exit({ code: 1, signal: null });

      const error = await probeError(probe);
      expect(error.code).toBe("exited_with_error");
      expect(error.message).toBe(
        `ffprobe exited with code 1: ${MEDIA_PATH}: Invalid data found when processing input`,
      );
    });

    it("reports an unrequested signal exit", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      child.exit({ code: null, signal: "SIGSEGV" });

      const error = await probeError(probe);
      expect(error.code).toBe("terminated_by_signal");
      expect(error.message).toBe("ffprobe was terminated by SIGSEGV");
    });

    it("keeps error messages concise however much stderr is produced", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      child.stderr.write("early diagnostic\n");
      child.stderr.write(`${"x".repeat(200 * 1024)}\n`);
      child.stderr.write("\u001b[31m\u0000control\u0007 characters\n");
      child.exit({ code: 1, signal: null });

      const error = await probeError(probe);
      expect(error.message).toBe(
        "ffprobe exited with code 1: control characters",
      );
    });

    it("truncates a single oversized stderr line", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      child.stderr.write("y".repeat(100 * 1024));
      child.exit({ code: 1, signal: null });

      const error = await probeError(probe);
      expect(error.message.length).toBeLessThanOrEqual(300);
      expect(error.message.endsWith("…")).toBe(true);
    });

    it("reports malformed JSON from a successful exit", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      child.stdout.write("Duration: 00:22:00");
      child.exit({ code: 0, signal: null });

      expect((await probeError(probe)).code).toBe("invalid_json");
    });

    it("reports unusable metadata from a successful exit", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      child.stdout.write(JSON.stringify({ format: {} }));
      child.exit({ code: 0, signal: null });

      expect((await probeError(probe)).code).toBe("invalid_metadata");
    });
  });

  describe("bounded execution", () => {
    it("terminates a child whose stdout exceeds 1 MiB and waits for closure", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      const state = track(probe);
      child.stdout.write(Buffer.alloc(ONE_MIB, 0x20));
      await flush();
      expect(child.terminationSignals).toEqual([]);

      child.stdout.write("x");
      await flush();
      expect(child.terminationSignals).toEqual(["SIGTERM"]);
      expect(state.settled).toBe(false);

      child.exit({ code: null, signal: "SIGTERM" });
      const error = await probeError(probe);
      expect(error.code).toBe("output_limit_exceeded");
    });

    it("times out at the configured deadline and waits for closure", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      const state = track(probe);

      await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
      expect(child.terminationSignals).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(child.terminationSignals).toEqual(["SIGTERM"]);
      expect(state.settled).toBe(false);

      child.exit({ code: null, signal: "SIGTERM" });
      const error = await probeError(probe);
      expect(error.code).toBe("timed_out");
      expect(error.message).toBe(`ffprobe timed out after ${TIMEOUT_MS} ms`);
    });

    it("does not force termination when the child closes within the grace period", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
      child.exit({ code: null, signal: "SIGTERM" });
      await probe.catch(() => undefined);

      await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
      expect(child.terminationSignals).toEqual(["SIGTERM"]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("forces termination after five seconds and still waits for closure", async () => {
      const probe = createProber().probe(MEDIA_PATH);
      const state = track(probe);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

      await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
      expect(child.terminationSignals).toEqual(["SIGTERM"]);

      await vi.advanceTimersByTimeAsync(1);
      expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL"]);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(state.settled).toBe(false);

      child.exit({ code: null, signal: "SIGKILL" });
      expect((await probeError(probe)).code).toBe("timed_out");
    });

    it("tolerates a termination request that throws", async () => {
      child.terminate = () => {
        throw new Error("kill EPERM");
      };
      const probe = createProber().probe(MEDIA_PATH);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + GRACE_MS);

      child.exit({ code: null, signal: "SIGKILL" });
      expect((await probeError(probe)).code).toBe("timed_out");
    });
  });

  describe("cancellation", () => {
    it("does not spawn when already cancelled", async () => {
      const controller = new AbortController();
      controller.abort();

      const error = await probeError(
        createProber().probe(MEDIA_PATH, { signal: controller.signal }),
      );
      expect(error.code).toBe("cancelled");
      expect(spawner.spawnCalls).toEqual([]);
    });

    it("terminates an active child and settles only after closure", async () => {
      const controller = new AbortController();
      const probe = createProber().probe(MEDIA_PATH, {
        signal: controller.signal,
      });
      const state = track(probe);

      controller.abort();
      await flush();
      expect(child.terminationSignals).toEqual(["SIGTERM"]);
      expect(state.settled).toBe(false);

      child.exit({ code: null, signal: "SIGTERM" });
      expect((await probeError(probe)).code).toBe("cancelled");
    });

    it("keeps the first stop reason and terminates once per stage", async () => {
      const controller = new AbortController();
      const probe = createProber().probe(MEDIA_PATH, {
        signal: controller.signal,
      });

      controller.abort();
      controller.abort();
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
      child.stdout.write(Buffer.alloc(ONE_MIB + 1));
      await flush();
      expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL"]);

      child.exit({ code: null, signal: "SIGKILL" });
      expect((await probeError(probe)).code).toBe("cancelled");
    });
  });

  describe("configuration", () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects timeoutMs %s",
      (timeoutMs) => {
        expect(() => createProber({ timeoutMs })).toThrow(RangeError);
      },
    );

    it("rejects an empty executable path", () => {
      expect(() => createProber({ ffprobePath: "" })).toThrow(RangeError);
    });
  });
});
