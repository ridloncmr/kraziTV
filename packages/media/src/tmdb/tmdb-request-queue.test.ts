import { heldRequests } from "../testing/held-tmdb-requests.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TmdbRequestQueue } from "./tmdb-request-queue.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TmdbRequestQueue", () => {
  it("runs at most the in-flight limit at once, starting the oldest waiter as a slot frees", async () => {
    const queue = new TmdbRequestQueue({ maxInFlight: 2, perSecond: 100 });
    const { started, releases, request } = heldRequests();

    const results = [1, 2, 3, 4].map((id) => queue.run(request(id)));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([1, 2]);

    releases[1]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([1, 2, 3]);

    releases[0]?.();
    releases[2]?.();
    await vi.advanceTimersByTimeAsync(0);
    releases[3]?.();
    await expect(Promise.all(results)).resolves.toEqual([1, 2, 3, 4]);
  });

  it("starts no more than the per-second limit within any one second", async () => {
    const queue = new TmdbRequestQueue({ maxInFlight: 10, perSecond: 3 });
    const startedAt: number[] = [];

    const results = Array.from({ length: 7 }, () =>
      queue.run(async () => {
        startedAt.push(Date.now());
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(startedAt).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(999);
    expect(startedAt).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(startedAt).toHaveLength(6);

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all(results);
    const origin = startedAt[0] ?? 0;
    expect(startedAt.map((time) => time - origin)).toEqual([
      0, 0, 0, 1_000, 1_000, 1_000, 2_000,
    ]);
  });

  it("shares one budget between every caller", async () => {
    const queue = new TmdbRequestQueue({ maxInFlight: 1, perSecond: 100 });
    const { started, releases, request } = heldRequests();

    void queue.run(request(1));
    void queue.run(request(2));
    await vi.advanceTimersByTimeAsync(0);

    expect(started).toEqual([1]);
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([1, 2]);
  });

  it("frees the slot when a request fails", async () => {
    const queue = new TmdbRequestQueue({ maxInFlight: 1, perSecond: 100 });

    await expect(
      queue.run(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    await expect(queue.run(async () => "next")).resolves.toBe("next");
  });

  it("lets a cancelled waiter leave without ever running its request", async () => {
    const queue = new TmdbRequestQueue({ maxInFlight: 1, perSecond: 100 });
    const { started, releases, request } = heldRequests();
    const controller = new AbortController();

    void queue.run(request(1));
    const cancelled = queue.run(request(2), { signal: controller.signal });
    const later = queue.run(request(3));
    await vi.advanceTimersByTimeAsync(0);

    controller.abort(new Error("cancelled"));
    await expect(cancelled).rejects.toThrow("cancelled");
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(started).toEqual([1, 3]);
    releases[1]?.();
    await expect(later).resolves.toBe(3);
  });

  it("refuses an already-cancelled request without running it", async () => {
    const queue = new TmdbRequestQueue({ maxInFlight: 1, perSecond: 100 });
    const request = vi.fn(async () => "ran");

    await expect(
      queue.run(request, { signal: AbortSignal.abort(new Error("gone")) }),
    ).rejects.toThrow("gone");
    expect(request).not.toHaveBeenCalled();
  });

  it("starts an urgent request before waiting ones, still within both limits", async () => {
    const queue = new TmdbRequestQueue({ maxInFlight: 1, perSecond: 100 });
    const { started, releases, request } = heldRequests();

    void queue.run(request(1));
    void queue.run(request(2));
    void queue.run(request(3), { urgent: true });
    void queue.run(request(4), { urgent: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([1]);

    releases[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    releases[1]?.();
    await vi.advanceTimersByTimeAsync(0);
    releases[2]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([1, 3, 4, 2]);
  });
});
