import { describe, expect, it } from "vitest";

import { ChannelLifecycleLock } from "./channel-lifecycle-lock.js";
import { flushMicrotasks } from "../../testing/flush-microtasks.js";

// Lets every already-queued promise reaction run; no timers are involved.
describe("ChannelLifecycleLock", () => {
  it("makes a second holder of one channel wait for the first to release", async () => {
    const lock = new ChannelLifecycleLock();
    const releaseFirst = await lock.acquire("channel-1");
    let secondAcquired = false;

    const second = lock.acquire("channel-1").then((release) => {
      secondAcquired = true;
      return release;
    });
    await flushMicrotasks(10);

    expect(secondAcquired).toBe(false);
    releaseFirst();
    (await second)();
    expect(secondAcquired).toBe(true);
  });

  it("grants holders in request order", async () => {
    const lock = new ChannelLifecycleLock();
    const order: string[] = [];
    const releaseFirst = await lock.acquire("channel-1");

    const second = lock.acquire("channel-1").then((release) => {
      order.push("second");
      release();
    });
    const third = lock.acquire("channel-1").then((release) => {
      order.push("third");
      release();
    });
    releaseFirst();
    await Promise.all([second, third]);

    expect(order).toEqual(["second", "third"]);
  });

  it("never makes one channel wait on another", async () => {
    const lock = new ChannelLifecycleLock();
    await lock.acquire("channel-1");

    const other = await lock.acquire("channel-2");

    expect(other).toBeTypeOf("function");
  });

  it("can be acquired again once released", async () => {
    const lock = new ChannelLifecycleLock();
    (await lock.acquire("channel-1"))();

    const again = await lock.acquire("channel-1");

    expect(again).toBeTypeOf("function");
  });
});
