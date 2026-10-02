import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSpawnedProcess } from "../testing/fake-spawned-process.js";
import { terminateProcess } from "./terminate-process.js";

const GRACE_MS = 1_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

// Reports whether a promise has settled without waiting for it.
function track<T>(promise: Promise<T>) {
  const state: { result?: T } = {};
  void promise.then((result) => (state.result = result));
  return state;
}

describe("terminateProcess", () => {
  it("stops at SIGTERM when the child closes within the grace period", async () => {
    const child = new FakeSpawnedProcess();
    const termination = terminateProcess(child, { graceMs: GRACE_MS });

    child.exit({ code: null, signal: "SIGTERM" });

    await expect(termination).resolves.toEqual({ closed: true });
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(child.terminationSignals).toEqual(["SIGTERM"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("escalates to SIGKILL exactly at the grace deadline", async () => {
    const child = new FakeSpawnedProcess();
    const state = track(terminateProcess(child, { graceMs: GRACE_MS }));

    await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
    expect(child.terminationSignals).toEqual(["SIGTERM"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL"]);

    child.exit({ code: null, signal: "SIGKILL" });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.result).toEqual({ closed: true });
  });

  it("reports an unverified termination after the second grace period", async () => {
    const child = new FakeSpawnedProcess();
    const state = track(terminateProcess(child, { graceMs: GRACE_MS }));

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2 - 1);
    expect(state.result).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(state.result).toEqual({ closed: false, cause: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("escalates past a failed signal and reports the last failure", async () => {
    const child = new FakeSpawnedProcess();
    const failure = new Error("kill EPERM");
    child.terminationError = failure;
    const state = track(terminateProcess(child, { graceMs: GRACE_MS }));

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);

    expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(state.result).toEqual({ closed: false, cause: failure });
  });
});
