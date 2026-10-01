import { describe, expect, it } from "vitest";

import { Deferred } from "../testing/deferred.js";
import { ChannelTransitionQueue } from "./channel-transition-queue.js";

describe("ChannelTransitionQueue", () => {
  it("runs one channel's operations in submission order", async () => {
    const queue = new ChannelTransitionQueue();
    const gate = new Deferred<void>();
    const order: string[] = [];

    const first = queue.run("channel-1", async () => {
      await gate.promise;
      order.push("first");
    });
    const second = queue.run("channel-1", () => {
      order.push("second");
    });
    gate.resolve();
    await Promise.all([first, second]);

    expect(order).toEqual(["first", "second"]);
  });

  it("does not hold one channel behind another", async () => {
    const queue = new ChannelTransitionQueue();
    const blocked = new Deferred<void>();

    void queue.run("channel-1", () => blocked.promise);
    await expect(queue.run("channel-2", () => "ran")).resolves.toBe("ran");
    blocked.resolve();
  });

  it("continues after a failed operation and still reports the failure", async () => {
    const queue = new ChannelTransitionQueue();

    const failed = queue.run("channel-1", () => {
      throw new Error("boom");
    });
    const next = queue.run("channel-1", () => "after");

    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("after");
  });

  it("lists only channels with queued work", async () => {
    const queue = new ChannelTransitionQueue();
    const gate = new Deferred<void>();

    const running = queue.run("channel-1", () => gate.promise);
    expect(queue.channelIds()).toEqual(["channel-1"]);

    gate.resolve();
    await running;
    await Promise.resolve();
    expect(queue.channelIds()).toEqual([]);
  });
});
