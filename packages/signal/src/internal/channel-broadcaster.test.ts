import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { ChannelBroadcaster } from "./channel-broadcaster.js";

const immediatelyJoinable = (): number => 0;

const markerJoinPoint =
  (marker: string) =>
  (retainedBytes: Buffer): number | undefined => {
    const offset = retainedBytes.indexOf(marker);
    return offset === -1 ? undefined : offset;
  };

const settleStreamEvents = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe("ChannelBroadcaster", () => {
  it("fans one ordered source out to independent subscribers", async () => {
    const source = new PassThrough();
    const broadcaster = new ChannelBroadcaster(source, {
      subscriberBufferLimitBytes: 16,
      retentionLimitBytes: 16,
      findJoinPoint: immediatelyJoinable,
    });
    const first = broadcaster.trySubscribe();
    const second = broadcaster.trySubscribe();
    const firstBytes: Buffer[] = [];
    const secondBytes: Buffer[] = [];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    first?.stream.on("data", (chunk: Buffer) => firstBytes.push(chunk));
    second?.stream.on("data", (chunk: Buffer) => secondBytes.push(chunk));

    source.write(Buffer.from("one"));
    source.write(Buffer.from("two"));
    source.end();
    await settleStreamEvents();

    expect(Buffer.concat(firstBytes).toString()).toBe("onetwo");
    expect(Buffer.concat(secondBytes).toString()).toBe("onetwo");
    await expect(first?.closed).resolves.toBe("source_ended");
    await expect(second?.closed).resolves.toBe("source_ended");
  });

  it("evicts only a subscriber whose byte limit would be exceeded", async () => {
    const source = new PassThrough();
    const broadcaster = new ChannelBroadcaster(source, {
      subscriberBufferLimitBytes: 4,
      retentionLimitBytes: 4,
      findJoinPoint: immediatelyJoinable,
    });
    const fast = broadcaster.trySubscribe();
    const stalled = broadcaster.trySubscribe();
    const fastBytes: Buffer[] = [];

    expect(fast).toBeDefined();
    expect(stalled).toBeDefined();
    fast?.stream.on("data", (chunk: Buffer) => fastBytes.push(chunk));

    source.write(Buffer.from("aa"));
    source.write(Buffer.from("bb"));
    source.write(Buffer.from("cc"));
    source.write(Buffer.from("dd"));
    source.end();
    await settleStreamEvents();

    expect(Buffer.concat(fastBytes).toString()).toBe("aabbccdd");
    await expect(stalled?.closed).resolves.toBe("buffer_limit_exceeded");
    await expect(fast?.closed).resolves.toBe("source_ended");
    expect(broadcaster.subscriberCount).toBe(0);
  });

  it("retains a bounded window while no subscribers are present", () => {
    const source = new PassThrough();
    const broadcaster = new ChannelBroadcaster(source, {
      subscriberBufferLimitBytes: 16,
      retentionLimitBytes: 5,
      findJoinPoint: immediatelyJoinable,
    });

    source.write(Buffer.from("1234"));
    source.write(Buffer.from("5678"));

    expect(source.readableLength).toBe(0);
    expect(broadcaster.retainedByteCount).toBe(5);
  });

  it("replays retained bytes from a joinable point", async () => {
    const source = new PassThrough();
    const broadcaster = new ChannelBroadcaster(source, {
      subscriberBufferLimitBytes: 32,
      retentionLimitBytes: 16,
      findJoinPoint: markerJoinPoint("INIT"),
    });

    source.write(Buffer.from("discard-"));
    expect(broadcaster.hasJoinableInitialization).toBe(false);
    expect(broadcaster.trySubscribe()).toBeUndefined();

    source.write(Buffer.from("INIT-first"));
    expect(broadcaster.hasJoinableInitialization).toBe(true);

    const subscription = broadcaster.trySubscribe();
    const received: Buffer[] = [];
    expect(subscription).toBeDefined();
    subscription?.stream.on("data", (chunk: Buffer) => received.push(chunk));

    source.write(Buffer.from("-live"));
    source.end();
    await settleStreamEvents();

    expect(Buffer.concat(received).toString()).toBe("INIT-first-live");
  });

  it("stops advertising a join point after retention evicts it", () => {
    const source = new PassThrough();
    const broadcaster = new ChannelBroadcaster(source, {
      subscriberBufferLimitBytes: 16,
      retentionLimitBytes: 8,
      findJoinPoint: markerJoinPoint("INIT"),
    });

    source.write(Buffer.from("INIT1234"));
    expect(broadcaster.hasJoinableInitialization).toBe(true);

    source.write(Buffer.from("5678"));

    expect(broadcaster.retainedByteCount).toBe(8);
    expect(broadcaster.hasJoinableInitialization).toBe(false);
    expect(broadcaster.trySubscribe()).toBeUndefined();
  });

  it("closes a subscription idempotently without affecting its peer", async () => {
    const source = new PassThrough();
    const broadcaster = new ChannelBroadcaster(source, {
      subscriberBufferLimitBytes: 16,
      retentionLimitBytes: 16,
      findJoinPoint: immediatelyJoinable,
    });
    const first = broadcaster.trySubscribe();
    const second = broadcaster.trySubscribe();
    const secondBytes: Buffer[] = [];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    second?.stream.on("data", (chunk: Buffer) => secondBytes.push(chunk));

    first?.close();
    first?.close();
    expect(broadcaster.subscriberCount).toBe(1);
    source.end(Buffer.from("still-live"));
    await settleStreamEvents();

    await expect(first?.closed).resolves.toBe("closed");
    await expect(second?.closed).resolves.toBe("source_ended");
    expect(Buffer.concat(secondBytes).toString()).toBe("still-live");
    expect(broadcaster.subscriberCount).toBe(0);
  });

  it("treats direct consumer stream destruction as one close", async () => {
    const source = new PassThrough();
    const broadcaster = new ChannelBroadcaster(source, {
      subscriberBufferLimitBytes: 16,
      retentionLimitBytes: 16,
      findJoinPoint: immediatelyJoinable,
    });
    const subscription = broadcaster.trySubscribe();

    expect(subscription).toBeDefined();
    subscription?.stream.destroy();
    await settleStreamEvents();
    subscription?.close();

    await expect(subscription?.closed).resolves.toBe("closed");
    expect(broadcaster.subscriberCount).toBe(0);
  });

  it("closes every subscriber when the shared source fails", async () => {
    const source = new PassThrough();
    const broadcaster = new ChannelBroadcaster(source, {
      subscriberBufferLimitBytes: 16,
      retentionLimitBytes: 16,
      findJoinPoint: immediatelyJoinable,
    });
    const first = broadcaster.trySubscribe();
    const second = broadcaster.trySubscribe();

    source.destroy(new Error("source failed"));
    await settleStreamEvents();

    await expect(first?.closed).resolves.toBe("source_failed");
    await expect(second?.closed).resolves.toBe("source_failed");
    expect(broadcaster.subscriberCount).toBe(0);
    expect(broadcaster.trySubscribe()).toBeUndefined();
  });

  it("allows a larger retained window when the joinable replay fits", async () => {
    const source = new PassThrough();
    const broadcaster = new ChannelBroadcaster(source, {
      subscriberBufferLimitBytes: 4,
      retentionLimitBytes: 8,
      findJoinPoint: markerJoinPoint("INIT"),
    });

    source.write(Buffer.from("xxxxINIT"));

    expect(broadcaster.hasJoinableInitialization).toBe(true);
    const subscription = broadcaster.trySubscribe();
    const received: Buffer[] = [];
    expect(subscription).toBeDefined();
    subscription?.stream.on("data", (chunk: Buffer) => received.push(chunk));

    source.end();
    await settleStreamEvents();

    expect(Buffer.concat(received).toString()).toBe("INIT");
  });

  it("rejects a joinable replay that exceeds the subscriber limit", () => {
    const source = new PassThrough();
    const broadcaster = new ChannelBroadcaster(source, {
      subscriberBufferLimitBytes: 4,
      retentionLimitBytes: 8,
      findJoinPoint: markerJoinPoint("INIT"),
    });

    source.write(Buffer.from("INITxxxx"));

    expect(broadcaster.hasJoinableInitialization).toBe(false);
    expect(broadcaster.trySubscribe()).toBeUndefined();
  });
});
