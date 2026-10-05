import { describe, expect, it, vi } from "vitest";

import type {
  ChannelAuthorization,
  ChannelAuthorizationResult,
} from "./channel-worker/contracts.js";
import type { ChannelSubscription } from "./channel-stream-manager/contracts.js";
import { createChannelStreamManager } from "./create-channel-stream-manager.js";
import { SignalError } from "./errors.js";
import type {
  ChannelId,
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  SelectedPlayoutItem,
} from "./playout/contracts.js";
import { FakeClock } from "./testing/fake-clock.js";
import { FakePlayoutProvider } from "./testing/fake-playout-provider.js";
import {
  FakeSignalPackager,
  type FakeSignalSession,
} from "./testing/fake-signal-packager.js";
import { InMemoryTransitionCoordinator } from "./testing/in-memory-transition-coordinator.js";
import { RecordingLogger } from "./testing/recording-logger.js";
import { expectSignalError } from "./testing/expect-signal-error.js";
import { settlePromises } from "./testing/settle-promises.js";

// Package-level scenarios: the real manager, worker, broadcaster, and
// transition loop run together. Only playout, packaging, coordination, and
// time are faked, and every interleaving is driven explicitly.

const CHANNEL = "channel-1";
const IDLE_GRACE_MS = 1_000;
const SUBSCRIBER_BUFFER_LIMIT_BYTES = 1_024;

/** One ten-second scheduled entry whose media starts at its own beginning. */
const entry = (
  scheduleEntryId: string,
  startsAt: number,
  channelId: ChannelId = CHANNEL,
): SelectedPlayoutItem => ({
  channelId,
  scheduleEntryId,
  scheduleRevision: 7,
  mediaItemId: `media-${scheduleEntryId}`,
  mediaPath: `C:/media/${scheduleEntryId}.mkv`,
  hasAudio: true,
  hasVideo: true,
  title: scheduleEntryId,
  startsAt,
  endsAt: startsAt + 10_000,
  durationMs: 10_000,
  startOffsetMs: 0,
});

/** Selected playout as the provider reports it at one evaluation instant. */
const current = (
  item: SelectedPlayoutItem,
  evaluatedAt: number,
): CurrentPlayoutResult => ({
  status: "current",
  channelId: item.channelId,
  scheduleRevision: item.scheduleRevision,
  evaluatedAt,
  mediaOffsetMs: item.startOffsetMs + evaluatedAt - item.startsAt,
  item,
});

/** A following-selection result continuing the current schedule revision. */
const following = (
  ...items: SelectedPlayoutItem[]
): FollowingPlayoutResult => ({
  status: "selected",
  channelId: CHANNEL,
  scheduleRevision: 7,
  items,
});

/** A dependency call that never answers, as a stalled database would. */
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

/** Drains stream and promise reactions so assertions see settled state. */
class SwitchableAuthorization implements ChannelAuthorization {
  private readonly disabled = new Set<ChannelId>();

  /** Mirrors an administrative disable that later lookups observe. */
  disable(channelId: ChannelId): void {
    this.disabled.add(channelId);
  }

  /** Enables every channel unless a scenario has disabled it. */
  async getChannelAuthorization(
    channelId: ChannelId,
  ): Promise<ChannelAuthorizationResult> {
    return this.disabled.has(channelId)
      ? { status: "disabled", channelId }
      : { status: "enabled", channelId };
  }
}

/** One joined viewer and everything its stream has delivered so far. */
type Viewer = {
  subscription: ChannelSubscription;
  received(): string;
};

/** Composes the production manager with only its outer ports faked. */
const scenario = ({ idleGraceMs = IDLE_GRACE_MS } = {}) => {
  const clock = new FakeClock(1_000);
  const provider = new FakePlayoutProvider();
  const packager = new FakeSignalPackager();
  const coordinator = new InMemoryTransitionCoordinator(clock);
  const authorization = new SwitchableAuthorization();
  const viewers: Viewer[] = [];
  coordinator.setSchedule(CHANNEL, 7, [
    entry("entry-1", 0),
    entry("entry-2", 10_000),
    entry("entry-3", 20_000),
  ]);
  const manager = createChannelStreamManager({
    authorization,
    idleGraceMs,
    logger: new RecordingLogger(),
    playoutProvider: provider,
    packager,
    clock,
    timers: clock,
    transitionCoordinator: coordinator,
    prepareLeadMs: 2_000,
    startupTimeoutMs: 5_000,
    subscriberBufferLimitBytes: SUBSCRIBER_BUFFER_LIMIT_BYTES,
    retentionLimitBytes: 1_024,
    findJoinPoint: (retained) =>
      retained.indexOf("INIT") === -1 ? undefined : retained.indexOf("INIT"),
  });

  return {
    clock,
    provider,
    packager,
    coordinator,
    authorization,
    manager,

    /** Arranges the worker's preliminary and final pre-spawn state lookups. */
    arrangeStartup(item: SelectedPlayoutItem, atMs = clock.now()): void {
      provider.enqueueCurrent(current(item, atMs));
      provider.enqueueCurrent(current(item, atMs));
    },

    /** Joins a viewer; a stalled viewer never reads its stream. */
    async subscribe(
      options: {
        channelId?: ChannelId;
        signal?: AbortSignal;
        reading?: boolean;
      } = {},
    ): Promise<Viewer> {
      const subscription = await manager.subscribe(
        options.channelId ?? CHANNEL,
        {
          signal: options.signal,
        },
      );
      const chunks: Buffer[] = [];
      if (options.reading !== false) {
        subscription.stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      }
      subscription.stream.on("error", () => undefined);
      const viewer = {
        subscription,
        received: () => Buffer.concat(chunks).toString(),
      };
      viewers.push(viewer);
      return viewer;
    },

    /** Returns the session a worker started, failing loudly if none did. */
    session(index: number): FakeSignalSession {
      const session = packager.sessions[index];
      if (session === undefined) throw new Error(`No session ${index} started`);
      return session;
    },

    /** Emits a joinable initialization and reports packager readiness. */
    async ready(index: number, initialization = "INIT-output"): Promise<void> {
      await settlePromises(10);
      const session = this.session(index);
      session.pushOutput(initialization);
      session.resolveReady();
      await settlePromises(10);
    },

    /** Advances wall time and lets every runtime reaction settle. */
    async advanceTo(atMs: number): Promise<void> {
      clock.advanceTo(atMs);
      await settlePromises(10);
    },

    /** Proves no timer, session, preparation, or viewer outlived the runtime. */
    expectNoLeaks(): void {
      expect(clock.pendingTimerCount).toBe(0);
      for (const session of packager.sessions) {
        expect(session.isStopped).toBe(true);
        expect(session.hasOutstandingPreparation).toBe(false);
        expect(session.unreleasedAtStop).toBe(0);
      }
      for (const viewer of viewers) {
        expect(viewer.subscription.stream.destroyed).toBe(true);
      }
    },
  };
};

/** Asserts a typed runtime failure and returns it for further checks. */
describe("createChannelStreamManager scenarios", () => {
  describe("startup and fan-out", () => {
    it.each([
      ["readiness arrives before joinable output", true],
      ["joinable output arrives before readiness", false],
    ])(
      "publishes only once both conditions hold: %s",
      async (_order, readinessFirst) => {
        const run = scenario();
        run.arrangeStartup(entry("entry-1", 0));
        let joined = false;
        const joining = run.subscribe().then((viewer) => {
          joined = true;
          return viewer;
        });
        await settlePromises(10);

        if (readinessFirst) run.session(0).resolveReady();
        else run.session(0).pushOutput("INIT-output");
        await settlePromises(10);
        expect(joined).toBe(false);

        if (readinessFirst) run.session(0).pushOutput("INIT-output");
        else run.session(0).resolveReady();
        await settlePromises(10);
        expect(joined).toBe(true);
        expect((await joining).received()).toBe("INIT-output");

        await run.manager.shutdown();
        await settlePromises(10);
        run.expectNoLeaks();
      },
    );

    it("shares one session and broadcast across concurrent viewers", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));

      const first = run.subscribe();
      const second = run.subscribe();
      await run.ready(0);
      const [a, b] = await Promise.all([first, second]);

      expect(run.packager.sessions).toHaveLength(1);
      run.session(0).pushOutput("-live");
      await settlePromises(10);
      expect(a.received()).toBe("INIT-output-live");
      expect(b.received()).toBe("INIT-output-live");

      a.subscription.close();
      run.session(0).pushOutput("-more");
      await settlePromises(10);
      expect(a.received()).toBe("INIT-output-live");
      expect(b.received()).toBe("INIT-output-live-more");
      expect(run.session(0).isStopped).toBe(false);

      await run.manager.shutdown();
      await settlePromises(10);
      run.expectNoLeaks();
    });

    it("rejects every waiter with one startup failure, then starts fresh", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      const first = run.subscribe();
      const second = run.subscribe();
      await settlePromises(10);
      const failure = new SignalError("packaging_failed", "FFmpeg exited");

      run.session(0).rejectReady(failure);
      const [firstError, secondError] = await Promise.all([
        expectSignalError(first, "packaging_failed"),
        expectSignalError(second, "packaging_failed"),
      ]);
      expect(firstError).toBe(secondError);
      expect(run.session(0).isStopped).toBe(true);

      run.arrangeStartup(entry("entry-1", 0));
      const retry = run.subscribe();
      await run.ready(1);
      await retry;
      expect(run.packager.sessions).toHaveLength(2);

      await run.manager.shutdown();
      await settlePromises(10);
      run.expectNoLeaks();
    });

    it("cancels a lone viewer before readiness without leaking its session", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      const controller = new AbortController();
      const joining = run.subscribe({ signal: controller.signal });
      await settlePromises(10);
      expect(run.packager.sessions).toHaveLength(1);

      controller.abort();
      await expectSignalError(joining, "subscription_aborted");
      await settlePromises(10);

      run.expectNoLeaks();
      await run.manager.shutdown();
    });

    it("joins a late viewer at the retained initialization point", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      const joining = run.subscribe();
      await run.ready(0, "noise-INIT-a");
      const early = await joining;

      run.session(0).pushOutput("-b");
      await settlePromises(10);
      const late = await run.subscribe();
      run.session(0).pushOutput("-c");
      await settlePromises(10);

      expect(early.received()).toBe("INIT-a-b-c");
      expect(late.received()).toBe("INIT-a-b-c");
      expect(run.packager.sessions).toHaveLength(1);

      await run.manager.shutdown();
      await settlePromises(10);
      run.expectNoLeaks();
    });

    it("evicts only a stalled viewer without backpressuring the shared signal", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      const joiningActive = run.subscribe();
      const joiningStalled = run.subscribe({ reading: false });
      await run.ready(0);
      const [active, stalled] = await Promise.all([
        joiningActive,
        joiningStalled,
      ]);

      const chunk = "x".repeat(SUBSCRIBER_BUFFER_LIMIT_BYTES / 2 + 1);
      run.session(0).pushOutput(chunk);
      run.session(0).pushOutput(chunk);
      await settlePromises(10);

      expect(stalled.subscription.stream.destroyed).toBe(true);
      expect(active.received()).toBe(`INIT-output${chunk}${chunk}`);
      expect(run.session(0).isStopped).toBe(false);

      active.subscription.close();
      await settlePromises(10);
      await run.advanceTo(run.clock.now() + IDLE_GRACE_MS);
      run.expectNoLeaks();
    });
  });

  describe("idle grace", () => {
    it("starts idle grace once for repeated closes, then stops the worker", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      const joining = run.subscribe();
      await run.ready(0);
      const viewer = await joining;

      viewer.subscription.close();
      viewer.subscription.close();
      await settlePromises(10);
      await run.advanceTo(1_000 + IDLE_GRACE_MS - 1);
      expect(run.session(0).isStopped).toBe(false);

      await run.advanceTo(1_000 + IDLE_GRACE_MS);
      run.expectNoLeaks();
    });

    it("keeps the same session when a viewer returns during idle grace", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      const joining = run.subscribe();
      await run.ready(0);
      (await joining).subscription.close();
      await settlePromises(10);

      await run.advanceTo(1_000 + IDLE_GRACE_MS / 2);
      const returning = await run.subscribe();
      await run.advanceTo(1_000 + IDLE_GRACE_MS * 2);

      expect(run.packager.sessions).toHaveLength(1);
      expect(run.session(0).isStopped).toBe(false);
      run.session(0).pushOutput("-live");
      await settlePromises(10);
      expect(returning.received()).toBe("INIT-output-live");

      await run.manager.shutdown();
      await settlePromises(10);
      run.expectNoLeaks();
    });

    // The viewer leaves at 9s; the grace length places idle expiry around the
    // 10s boundary. `undefined` marks the same-instant race, where either
    // event may win and only the invariants are asserted.
    it.each([
      ["idle expiry just before the boundary", 999, ["entry-1"]],
      ["idle expiry just after the boundary", 1_001, ["entry-1", "entry-2"]],
      ["idle expiry at the boundary instant", 1_000, undefined],
    ])(
      "stops once and never transitions afterward: %s",
      async (_order, idleGraceMs, expected) => {
        const run = scenario({ idleGraceMs });
        run.arrangeStartup(entry("entry-1", 0));
        run.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
        run.provider.enqueueFollowing(following(entry("entry-3", 20_000)));
        const joining = run.subscribe();
        await run.ready(0);
        const viewer = await joining;
        await run.advanceTo(8_000);
        await run.advanceTo(9_000);
        viewer.subscription.close();
        await settlePromises(10);

        for (const atMs of [9_999, 10_000, 10_001]) {
          await run.advanceTo(atMs);
        }

        const committed = run
          .session(0)
          .committedItems.map((item) => item.scheduleEntryId);
        if (expected !== undefined) expect(committed).toEqual(expected);
        expect(committed.slice(0, 1)).toEqual(["entry-1"]);
        expect(committed.length).toBeLessThanOrEqual(2);
        expect(run.coordinator.calls.length).toBeLessThanOrEqual(1);
        run.expectNoLeaks();

        await run.advanceTo(20_000);
        expect(run.session(0).committedItems).toHaveLength(committed.length);
        expect(run.packager.sessions).toHaveLength(1);
        await run.manager.shutdown();
      },
    );
  });

  describe("transitions under the manager", () => {
    it("crosses successive boundaries while viewers stay attached", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      run.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
      run.provider.enqueueFollowing(following(entry("entry-3", 20_000)));
      const joining = run.subscribe();
      await run.ready(0);
      const viewer = await joining;

      for (const atMs of [8_000, 10_000, 18_000, 20_000]) {
        await run.advanceTo(atMs);
      }
      run.session(0).pushOutput("-after");
      await settlePromises(10);

      expect(
        run.session(0).committedItems.map((item) => item.scheduleEntryId),
      ).toEqual(["entry-1", "entry-2", "entry-3"]);
      expect(run.session(0).discardedItems).toEqual([]);
      expect(viewer.received()).toBe("INIT-output-after");
      expect(viewer.subscription.stream.destroyed).toBe(false);

      await run.manager.shutdown();
      await settlePromises(10);
      run.expectNoLeaks();
    });

    it("recovers a stale preparation with fresh playout while viewers stay attached", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      run.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
      const joining = run.subscribe();
      await run.ready(0);
      const viewer = await joining;
      await run.advanceTo(8_000);

      const regenerated = { ...entry("entry-2b", 10_000), scheduleRevision: 8 };
      run.coordinator.setSchedule(CHANNEL, 8, [
        entry("entry-1", 0),
        regenerated,
      ]);
      run.provider.enqueueCurrent(current(regenerated, 10_000));
      await run.advanceTo(10_000);

      expect(
        run.session(0).discardedItems.map((item) => item.scheduleEntryId),
      ).toEqual(["entry-2"]);
      expect(
        run.session(0).committedItems.map((item) => item.scheduleEntryId),
      ).toEqual(["entry-1", "entry-2b"]);
      expect(viewer.subscription.stream.destroyed).toBe(false);

      await run.manager.shutdown();
      await settlePromises(10);
      run.expectNoLeaks();
    });

    it("unpublishes a worker whose lookup stalls and serves the next viewer fresh", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      const joining = run.subscribe();
      await run.ready(0);
      const viewer = await joining;
      const stalled = vi
        .spyOn(run.provider, "getFollowing")
        .mockImplementation(never);

      await run.advanceTo(8_000);
      await run.advanceTo(10_000);
      expect(run.session(0).isStopped).toBe(false);
      await run.advanceTo(15_000);

      expect(run.session(0).isStopped).toBe(true);
      expect(viewer.subscription.stream.destroyed).toBe(true);

      stalled.mockRestore();
      run.arrangeStartup(entry("entry-2", 10_000));
      const rejoining = run.subscribe();
      await run.ready(1);
      await rejoining;
      expect(run.packager.sessions).toHaveLength(2);

      await run.manager.shutdown();
      await settlePromises(10);
      run.expectNoLeaks();
    });
  });

  describe("administrative stop and shutdown", () => {
    it("discards a held preparation and closes viewers on administrative stop", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      run.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
      const joining = run.subscribe();
      await run.ready(0);
      await joining;
      await run.advanceTo(8_000);
      expect(run.session(0).hasOutstandingPreparation).toBe(true);

      run.authorization.disable(CHANNEL);
      await run.manager.stopChannel(CHANNEL, "disabled");
      await settlePromises(10);

      expect(
        run.session(0).discardedItems.map((item) => item.scheduleEntryId),
      ).toEqual(["entry-2"]);
      run.expectNoLeaks();

      await run.advanceTo(10_000);
      expect(run.coordinator.calls).toEqual([]);
      await expectSignalError(
        run.manager.subscribe(CHANNEL),
        "channel_disabled",
      );
      expect(run.packager.sessions).toHaveLength(1);
    });

    it("retries an administrative stop whose preparation discard failed", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      run.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
      const joining = run.subscribe();
      await run.ready(0);
      const viewer = await joining;
      await run.advanceTo(8_000);
      const failure = new Error("FFmpeg process refused discard");
      run.session(0).failDiscards(failure, failure, failure);

      await expect(
        run.manager.stopChannel(CHANNEL, "disabled"),
      ).rejects.toMatchObject({ code: "runtime_cleanup_failed" });
      expect(viewer.subscription.stream.destroyed).toBe(true);

      await run.manager.stopChannel(CHANNEL, "disabled");
      await settlePromises(10);
      run.expectNoLeaks();
    });

    it("settles an active channel and a channel still starting on shutdown", async () => {
      const run = scenario();
      run.arrangeStartup(entry("entry-1", 0));
      const joining = run.subscribe();
      await run.ready(0);
      await joining;

      run.arrangeStartup(entry("other-1", 0, "channel-2"));
      const starting = run.manager.subscribe("channel-2");
      await settlePromises(10);
      expect(run.packager.sessions).toHaveLength(2);

      await run.manager.shutdown();
      await expectSignalError(starting, "manager_shutdown");
      await settlePromises(10);
      run.expectNoLeaks();
      await expectSignalError(
        run.manager.subscribe(CHANNEL),
        "manager_shutdown",
      );
    });
  });
});
