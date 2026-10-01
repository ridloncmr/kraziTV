import { MediaProbeError } from "@krazitv/media";
import { describe, expect, it } from "vitest";

import { ConcurrencyLimitedProber } from "./concurrency-limited-prober.js";
import { ControlledProber } from "../../testing/controlled-prober.js";

const RESULT = { durationMs: 1_000, hasAudio: true };

// Lets queued promise continuations run so assertions see settled scheduling.
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("ConcurrencyLimitedProber", () => {
  it("never runs more probes than the limit and starts queued probes in order", async () => {
    const inner = new ControlledProber();
    const limited = new ConcurrencyLimitedProber(inner, 2);

    const results = ["a", "b", "c", "d"].map((path) => limited.probe(path));
    await flush();
    expect(inner.started.map((probe) => probe.path)).toEqual(["a", "b"]);

    inner.get("b").resolve(RESULT);
    await flush();
    expect(inner.started.map((probe) => probe.path)).toEqual(["a", "b", "c"]);

    inner.get("a").resolve(RESULT);
    inner.get("c").resolve(RESULT);
    await flush();
    inner.get("d").resolve(RESULT);

    await expect(Promise.all(results)).resolves.toHaveLength(4);
    expect(inner.maxActive).toBe(2);
  });

  it("releases a slot when a probe fails", async () => {
    const inner = new ControlledProber();
    const limited = new ConcurrencyLimitedProber(inner, 1);

    const first = limited.probe("a");
    const second = limited.probe("b");
    await flush();
    inner.get("a").reject(new MediaProbeError("timed_out", "timed out"));

    await expect(first).rejects.toMatchObject({ code: "timed_out" });
    await flush();
    inner.get("b").resolve(RESULT);
    await expect(second).resolves.toEqual(RESULT);
  });

  it("keeps a cancelled probe's slot until the underlying probe settles", async () => {
    const inner = new ControlledProber();
    const limited = new ConcurrencyLimitedProber(inner, 1);
    const controller = new AbortController();

    const cancelled = limited.probe("a", { signal: controller.signal });
    const queued = limited.probe("b");
    await flush();

    controller.abort();
    await flush();
    // The child for "a" is still terminating, so "b" must keep waiting.
    expect(inner.started.map((probe) => probe.path)).toEqual(["a"]);
    expect(inner.get("a").signal?.aborted).toBe(true);

    inner.rejectCancelled("a");
    await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
    await flush();
    expect(inner.started.map((probe) => probe.path)).toEqual(["a", "b"]);
    inner.get("b").resolve(RESULT);
    await expect(queued).resolves.toEqual(RESULT);
  });

  it("rejects a queued probe as cancelled without ever starting it", async () => {
    const inner = new ControlledProber();
    const limited = new ConcurrencyLimitedProber(inner, 1);
    const controller = new AbortController();

    const running = limited.probe("a");
    const queued = limited.probe("b", { signal: controller.signal });
    const later = limited.probe("c");
    await flush();

    controller.abort();
    await expect(queued).rejects.toBeInstanceOf(MediaProbeError);
    await expect(queued).rejects.toMatchObject({ code: "cancelled" });

    inner.get("a").resolve(RESULT);
    await running;
    await flush();
    expect(inner.started.map((probe) => probe.path)).toEqual(["a", "c"]);
    inner.get("c").resolve(RESULT);
    await later;
  });

  it("rejects an already-cancelled request without starting it", async () => {
    const inner = new ControlledProber();
    const limited = new ConcurrencyLimitedProber(inner, 1);

    await expect(
      limited.probe("a", { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(inner.started).toHaveLength(0);
  });

  it("shares one limit between independent callers", async () => {
    const inner = new ControlledProber();
    const limited = new ConcurrencyLimitedProber(inner, 3);

    const first = ["r1-a", "r1-b", "r1-c"].map((path) => limited.probe(path));
    const second = ["r2-a", "r2-b", "r2-c"].map((path) => limited.probe(path));
    await flush();
    expect(inner.active).toBe(3);

    while (inner.active > 0) {
      inner.resolveAll(RESULT);
      await flush();
    }

    await Promise.all([...first, ...second]);
    expect(inner.maxActive).toBe(3);
  });
});
