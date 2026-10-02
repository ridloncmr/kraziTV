import { describe, expect, it } from "vitest";

import type { ChannelAuthorization } from "./channel-worker/contracts.js";
import type { ChannelStreamManagerContract } from "./channel-stream-manager/contracts.js";
import { createChannelStreamManager } from "./create-channel-stream-manager.js";
import type { OutputReadinessInspector } from "./ffmpeg/contracts.js";
import { FfmpegSignalPackager } from "./ffmpeg/packaging/ffmpeg-signal-packager.js";
import type { CurrentPlayoutResult } from "./playout/contracts.js";
import type { SignalLogger } from "./runtime/signal-logger.js";
import { FakeClock } from "./testing/fake-clock.js";
import { InMemoryTransitionCoordinator } from "./testing/in-memory-transition-coordinator.js";
import { FakePlayoutProvider } from "./testing/fake-playout-provider.js";
import { FakeProcess, FakeProcessSpawner } from "./testing/fake-process.js";
import { settlePromises } from "./testing/settle-promises.js";

class SilentLogger implements SignalLogger {
  /** Discards diagnostics that these lifecycle assertions do not inspect. */
  debug(): void {}

  /** Discards diagnostics that these lifecycle assertions do not inspect. */
  info(): void {}

  /** Discards diagnostics that these lifecycle assertions do not inspect. */
  warn(): void {}

  /** Discards diagnostics that these lifecycle assertions do not inspect. */
  error(): void {}
}

class MarkerInspector implements OutputReadinessInspector {
  /** Treats an explicit test marker as usable media output. */
  observe(chunk: Uint8Array): boolean {
    return Buffer.from(chunk).includes("usable-output");
  }
}

class EnabledAuthorization implements ChannelAuthorization {
  /** Authorizes the requested channel so cleanup is the only behavior under test. */
  async getChannelAuthorization(channelId: string) {
    return { status: "enabled" as const, channelId };
  }
}

const currentItem = (evaluatedAt: number): CurrentPlayoutResult => ({
  status: "current",
  channelId: "channel-1",
  scheduleRevision: 1,
  evaluatedAt,
  mediaOffsetMs: evaluatedAt,
  item: {
    channelId: "channel-1",
    scheduleEntryId: "entry-1",
    scheduleRevision: 1,
    mediaItemId: "media-1",
    mediaPath: "C:/media/movie.mkv",
    hasAudio: true,
    title: "Movie",
    startsAt: 0,
    endsAt: 60_000,
    durationMs: 60_000,
    startOffsetMs: 0,
  },
});

/** Supplies one retained transport packet carrying both test readiness markers. */
const usableOutput = (): Buffer => {
  const output = Buffer.alloc(188);
  output.write("INIT usable-output");
  return output;
};

/** Composes the production manager with only process and time boundaries faked. */
const createHarness = () => {
  const clock = new FakeClock(1_000);
  const child = new FakeProcess();
  const spawner = new FakeProcessSpawner();
  spawner.enqueue(child);
  const playoutProvider = new FakePlayoutProvider();
  playoutProvider.enqueueCurrent(currentItem(1_000));
  playoutProvider.enqueueCurrent(currentItem(1_000));
  const manager = createChannelStreamManager({
    authorization: new EnabledAuthorization(),
    idleGraceMs: 1_000,
    playoutProvider,
    packager: new FfmpegSignalPackager({
      spawner,
      timers: clock,
      logger: new SilentLogger(),
      terminationGraceMs: 500,
      createReadinessInspector: () => new MarkerInspector(),
    }),
    clock,
    timers: clock,
    transitionCoordinator: new InMemoryTransitionCoordinator(clock),
    prepareLeadMs: 2_000,
    startupTimeoutMs: 5_000,
    subscriberBufferLimitBytes: 1_024,
    retentionLimitBytes: 1_024,
    findJoinPoint: (retainedBytes) =>
      retainedBytes.indexOf("INIT") === -1
        ? undefined
        : retainedBytes.indexOf("INIT"),
  });
  return { child, clock, manager, playoutProvider, spawner };
};

const lifecycleStops: ReadonlyArray<{
  name: string;
  stop(manager: ChannelStreamManagerContract): Promise<void>;
}> = [
  {
    name: "an administrative stop",
    stop: (manager) => manager.stopChannel("channel-1", "disabled"),
  },
  { name: "terminal shutdown", stop: (manager) => manager.shutdown() },
];

describe("createChannelStreamManager", () => {
  it.each(lifecycleStops)(
    "settles $name only after the FFmpeg child has exited",
    async ({ stop }) => {
      const { child, manager } = createHarness();
      const subscribing = manager.subscribe("channel-1");
      await settlePromises();
      child.writeStdout(usableOutput());
      const subscription = await subscribing;
      subscription.stream.resume();

      let stopSettled = false;
      const stopping = stop(manager).finally(() => {
        stopSettled = true;
      });
      await settlePromises();

      expect(child.terminationSignals).toEqual(["SIGTERM"]);
      expect(subscription.stream.closed).toBe(true);
      expect(stopSettled).toBe(false);

      child.exit({ code: null, signal: "SIGTERM" });
      await stopping;
      await manager.shutdown();
    },
  );

  it("retries a shutdown whose FFmpeg child ignored forced termination", async () => {
    const { child, clock, manager } = createHarness();
    const subscribing = manager.subscribe("channel-1");
    await settlePromises();
    child.writeStdout(usableOutput());
    const subscription = await subscribing;
    subscription.stream.resume();

    const firstShutdown = manager.shutdown();
    const firstFailure = expect(firstShutdown).rejects.toMatchObject({
      code: "runtime_cleanup_failed",
    });
    await settlePromises();
    clock.advanceBy(500);
    await settlePromises();
    clock.advanceBy(500);
    await firstFailure;
    expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL"]);

    const retryShutdown = manager.shutdown();
    await settlePromises();
    expect(child.terminationSignals).toEqual(["SIGTERM", "SIGKILL", "SIGTERM"]);
    child.exit({ code: null, signal: "SIGKILL" });
    await retryShutdown;
  });

  it("spawns no second FFmpeg child until a cancelled startup's child has exited", async () => {
    const { child, clock, manager, playoutProvider, spawner } = createHarness();
    const controller = new AbortController();
    const subscribing = manager.subscribe("channel-1", {
      signal: controller.signal,
    });
    await settlePromises();

    // Cancellation is caller-owned, so the viewer is released at once; the
    // manager, not the waiter, keeps one FFmpeg process per channel.
    controller.abort();
    await expect(subscribing).rejects.toMatchObject({
      code: "subscription_aborted",
    });
    expect(child.terminationSignals).toEqual(["SIGTERM"]);

    const replacement = new FakeProcess();
    spawner.enqueue(replacement);
    playoutProvider.enqueueCurrent(currentItem(1_000));
    playoutProvider.enqueueCurrent(currentItem(1_000));
    const retrying = manager.subscribe("channel-1");
    await settlePromises();
    expect(spawner.spawnCalls).toHaveLength(1);

    child.exit({ code: null, signal: "SIGTERM" });
    await settlePromises();
    expect(spawner.spawnCalls).toHaveLength(2);

    replacement.writeStdout(usableOutput());
    (await retrying).stream.resume();
    const shutdown = manager.shutdown();
    await settlePromises();
    replacement.exit({ code: null, signal: "SIGTERM" });
    await shutdown;
    expect(clock.pendingTimerCount).toBe(0);
  });

  it("terminates the FFmpeg child when startup outlasts its timeout", async () => {
    const { child, clock, manager } = createHarness();
    const subscribing = manager.subscribe("channel-1");
    let subscribeSettled = false;
    void subscribing.catch(() => (subscribeSettled = true));
    const rejected = expect(subscribing).rejects.toMatchObject({
      code: "worker_startup_timeout",
    });
    await settlePromises();

    clock.advanceBy(5_000);
    await settlePromises();
    expect(child.terminationSignals).toEqual(["SIGTERM"]);
    expect(subscribeSettled).toBe(false);

    child.exit({ code: null, signal: "SIGTERM" });
    await rejected;
    await settlePromises();
    expect(clock.pendingTimerCount).toBe(0);
    await manager.shutdown();
  });
});
