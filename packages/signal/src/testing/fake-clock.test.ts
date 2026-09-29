import { describe, expect, it, vi } from "vitest";

import { FakeClock } from "./fake-clock.js";

describe("FakeClock", () => {
  it("runs timers deterministically in deadline and registration order", () => {
    const clock = new FakeClock(1_000);
    const calls: string[] = [];

    clock.setTimeout(() => calls.push("later"), 20);
    clock.setTimeout(() => calls.push("first"), 10);
    clock.setTimeout(() => calls.push("second"), 10);

    clock.advanceBy(10);

    expect(calls).toEqual(["first", "second"]);
    expect(clock.now()).toBe(1_010);
    expect(clock.pendingTimerCount).toBe(1);

    clock.advanceTo(1_020);

    expect(calls).toEqual(["first", "second", "later"]);
    expect(clock.pendingTimerCount).toBe(0);
  });

  it("cancels a timer idempotently", () => {
    const clock = new FakeClock();
    const callback = vi.fn();
    const timer = clock.setTimeout(callback, 5);

    timer.cancel();
    timer.cancel();
    clock.advanceBy(5);

    expect(callback).not.toHaveBeenCalled();
    expect(timer.active).toBe(false);
    expect(clock.pendingTimerCount).toBe(0);
  });

  it("runs timers scheduled by a callback at the current time", () => {
    const clock = new FakeClock();
    const calls: string[] = [];

    clock.setTimeout(() => {
      calls.push("outer");
      clock.setTimeout(() => calls.push("inner"), 0);
    }, 5);

    clock.advanceBy(5);

    expect(calls).toEqual(["outer", "inner"]);
  });
});
