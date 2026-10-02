import { describe, expect, it, vi } from "vitest";

import { SignalError } from "../errors.js";
import type {
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  SelectedPlayoutItem,
} from "../playout/contracts.js";
import { Deferred } from "../testing/deferred.js";
import { FakeClock } from "../testing/fake-clock.js";
import { FakePlayoutProvider } from "../testing/fake-playout-provider.js";
import {
  FakeSignalPackager,
  type FakeSignalSession,
} from "../testing/fake-signal-packager.js";
import { InMemoryTransitionCoordinator } from "../testing/in-memory-transition-coordinator.js";
import type { TimerScheduler } from "../runtime/clock.js";
import { ChannelWorker, type ChannelWorkerOptions } from "./channel-worker.js";
import type { TransitionCoordinator } from "./contracts.js";
import { expectSignalError } from "../testing/expect-signal-error.js";
import { settlePromises } from "../testing/settle-promises.js";

const CHANNEL = "channel-1";
const PREPARE_LEAD_MS = 2_000;

/** One ten-second scheduled entry whose media starts at its own beginning. */
const entry = (
  scheduleEntryId: string,
  startsAt: number,
  overrides: Partial<SelectedPlayoutItem> = {},
): SelectedPlayoutItem => ({
  channelId: CHANNEL,
  scheduleEntryId,
  scheduleRevision: 7,
  mediaItemId: `media-${scheduleEntryId}`,
  mediaPath: `C:/media/${scheduleEntryId}.mkv`,
  hasAudio: true,
  title: scheduleEntryId,
  startsAt,
  endsAt: startsAt + 10_000,
  durationMs: 10_000,
  startOffsetMs: 0,
  ...overrides,
});

const current = (
  item: SelectedPlayoutItem,
  evaluatedAt: number,
): CurrentPlayoutResult => ({
  status: "current",
  channelId: CHANNEL,
  scheduleRevision: item.scheduleRevision,
  evaluatedAt,
  mediaOffsetMs: item.startOffsetMs + evaluatedAt - item.startsAt,
  item,
});

const following = (
  ...items: SelectedPlayoutItem[]
): FollowingPlayoutResult => ({
  status: "selected",
  channelId: CHANNEL,
  scheduleRevision: items[0]?.scheduleRevision ?? 7,
  items,
});

/** Advances wall time and lets the worker react before asserting. */
const advanceTo = async (clock: FakeClock, atMs: number): Promise<void> => {
  clock.advanceTo(atMs);
  await settlePromises(5);
};

type Harness = {
  clock: FakeClock;
  provider: FakePlayoutProvider;
  packager: FakeSignalPackager;
  coordinator: InMemoryTransitionCoordinator;
};

/** Arranges a channel airing entry-1 from 0 to 10s, tuned in at 1s. */
const harness = (): Harness => {
  const clock = new FakeClock(1_000);
  const provider = new FakePlayoutProvider();
  const coordinator = new InMemoryTransitionCoordinator(clock);
  coordinator.setSchedule(CHANNEL, 7, [
    entry("entry-1", 0),
    entry("entry-2", 10_000),
    entry("entry-3", 20_000),
  ]);
  provider.enqueueCurrent(current(entry("entry-1", 0), 1_000));
  provider.enqueueCurrent(current(entry("entry-1", 0), 1_000));
  return { clock, provider, packager: new FakeSignalPackager(), coordinator };
};

/** Starts a ready worker so tests begin at the first transition cycle. */
const startWorker = async (
  { clock, provider, packager, coordinator }: Harness,
  overrides: Partial<ChannelWorkerOptions> = {},
): Promise<{ worker: ChannelWorker; session: FakeSignalSession }> => {
  const starting = ChannelWorker.start(CHANNEL, new AbortController().signal, {
    playoutProvider: provider,
    packager,
    clock,
    timers: clock,
    transitionCoordinator: coordinator,
    prepareLeadMs: PREPARE_LEAD_MS,
    startupTimeoutMs: 5_000,
    subscriberBufferLimitBytes: 1_024,
    retentionLimitBytes: 1_024,
    findJoinPoint: (retained: Buffer) =>
      retained.indexOf("INIT") === -1 ? undefined : retained.indexOf("INIT"),
    ...overrides,
  });
  await settlePromises(5);
  const session = packager.sessions[0];
  if (session === undefined) throw new Error("Worker did not start a session");
  session.pushOutput("INIT-output");
  session.resolveReady();
  return { worker: await starting, session };
};

const committedEntries = (session: FakeSignalSession): string[] =>
  session.committedItems.map((item) => item.scheduleEntryId);

/** A dependency call that never answers, as a stalled database or FFmpeg process. */
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

/** Records whether a promise has settled without consuming its outcome. */
const trackSettled = (promise: Promise<unknown>): (() => boolean) => {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  return () => settled;
};

/** Boundary of entry-1 plus the recovery timeout the harness configures. */
const TRANSITION_DEADLINE_MS = 15_000;

describe("ChannelWorker following-item transitions", () => {
  it("prepares the following item only once its lead time arrives", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);

    await advanceTo(setup.clock, 7_999);
    expect(setup.provider.followingCalls).toEqual([]);
    expect(session.prepareCalls).toEqual([]);

    await advanceTo(setup.clock, 8_000);
    expect(setup.provider.followingCalls).toEqual([
      { channelId: CHANNEL, afterScheduleEntryId: "entry-1", count: 1 },
    ]);
    expect(session.prepareCalls).toEqual([
      {
        channelId: CHANNEL,
        scheduleEntryId: "entry-2",
        mediaItemId: "media-entry-2",
        mediaPath: "C:/media/entry-2.mkv",
        hasAudio: true,
        mediaOffsetMs: 0,
        playDurationMs: 10_000,
      },
    ]);
    expect(setup.coordinator.calls).toEqual([]);
    expect(committedEntries(session)).toEqual(["entry-1"]);

    await worker.stop();
  });

  it("commits the prepared item exactly once, never before its boundary", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);

    await advanceTo(setup.clock, 9_999);
    expect(setup.coordinator.calls).toEqual([]);
    expect(committedEntries(session)).toEqual(["entry-1"]);

    await advanceTo(setup.clock, 10_000);
    expect(setup.coordinator.calls).toEqual([
      {
        candidate: {
          channelId: CHANNEL,
          scheduleEntryId: "entry-2",
          scheduleRevision: 7,
        },
        atMs: 10_000,
      },
    ]);
    expect(committedEntries(session)).toEqual(["entry-1", "entry-2"]);

    await worker.stop();
  });

  it("repeats transitions with one following lookup and one preparation per boundary", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    setup.provider.enqueueFollowing(following(entry("entry-3", 20_000)));
    const { worker, session } = await startWorker(setup);

    await advanceTo(setup.clock, 10_000);
    await advanceTo(setup.clock, 17_999);
    expect(session.prepareCalls).toHaveLength(1);
    await advanceTo(setup.clock, 20_000);

    expect(
      setup.provider.followingCalls.map((call) => call.afterScheduleEntryId),
    ).toEqual(["entry-1", "entry-2"]);
    expect(committedEntries(session)).toEqual([
      "entry-1",
      "entry-2",
      "entry-3",
    ]);
    expect(session.discardedItems).toEqual([]);

    await worker.stop();
    expect(setup.clock.pendingTimerCount).toBe(0);
  });

  it("discards a stale preparation and commits freshly selected current playout", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);
    await advanceTo(setup.clock, 8_000);

    const regenerated = entry("entry-2b", 10_000, { scheduleRevision: 8 });
    setup.coordinator.setSchedule(CHANNEL, 8, [
      entry("entry-1", 0),
      regenerated,
    ]);
    setup.provider.enqueueCurrent(current(regenerated, 10_000));
    await advanceTo(setup.clock, 10_000);

    expect(session.discardedItems.map((item) => item.scheduleEntryId)).toEqual([
      "entry-2",
    ]);
    expect(setup.provider.currentCalls.at(-1)).toEqual({
      channelId: CHANNEL,
      atMs: 10_000,
    });
    expect(session.prepareCalls.at(-1)).toMatchObject({
      scheduleEntryId: "entry-2b",
      mediaOffsetMs: 0,
      playDurationMs: 10_000,
    });
    expect(committedEntries(session)).toEqual(["entry-1", "entry-2b"]);

    await worker.stop();
  });

  it.each([
    [
      "a stale entry",
      {
        status: "stale_entry",
        channelId: CHANNEL,
        scheduleRevision: 8,
        items: [],
      } satisfies FollowingPlayoutResult,
    ],
    ["an empty selection", following()],
    [
      "a cross-channel item",
      following(entry("entry-2", 10_000, { channelId: "channel-2" })),
    ],
    [
      "a cross-channel result",
      { ...following(entry("entry-2", 10_000)), channelId: "channel-2" },
    ],
    ["a non-contiguous item", following(entry("entry-2", 10_500))],
  ])(
    "treats %s as stale selection and resolves fresh playout at the boundary",
    async (_label, result) => {
      const setup = harness();
      setup.provider.enqueueFollowing(result);
      setup.provider.enqueueCurrent(current(entry("entry-2", 10_000), 10_000));
      const { worker, session } = await startWorker(setup);

      await advanceTo(setup.clock, 9_999);
      expect(session.prepareCalls).toEqual([]);
      expect(setup.provider.currentCalls).toHaveLength(2);

      await advanceTo(setup.clock, 10_000);
      expect(committedEntries(session)).toEqual(["entry-1", "entry-2"]);

      await worker.stop();
    },
  );

  it("stop discards an unused preparation and cancels the pending boundary", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);
    await advanceTo(setup.clock, 8_000);

    await worker.stop();
    expect(session.discardedItems.map((item) => item.scheduleEntryId)).toEqual([
      "entry-2",
    ]);
    expect(setup.clock.pendingTimerCount).toBe(0);

    await advanceTo(setup.clock, 10_000);
    expect(setup.coordinator.calls).toEqual([]);
    await expect(worker.completion).resolves.toBeUndefined();
  });

  it("refuses a commit callback that arrives after stop", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const pending = new Deferred<void>();
    let commit: (() => void) | undefined;
    const coordinator: TransitionCoordinator = {
      async commitPreparedTransition(_candidate, callback) {
        commit = callback;
        await pending.promise;
        callback();
        return "committed";
      },
    };
    const { worker, session } = await startWorker(setup, {
      transitionCoordinator: coordinator,
    });
    await advanceTo(setup.clock, 10_000);
    expect(commit).toBeDefined();

    const stopping = worker.stop();
    pending.resolve();
    await stopping;
    await settlePromises(5);

    expect(() => commit?.()).toThrow();
    expect(committedEntries(session)).toEqual(["entry-1"]);
    await expect(worker.completion).resolves.toBeUndefined();
  });

  it("fails the worker instead of extending the item when commit fails", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const failure = new Error("database is locked");
    const coordinator: TransitionCoordinator = {
      async commitPreparedTransition() {
        throw failure;
      },
    };
    const { worker, session } = await startWorker(setup, {
      transitionCoordinator: coordinator,
    });
    await advanceTo(setup.clock, 10_000);

    const error = await expectSignalError(
      worker.completion,
      "transition_failed",
    );
    expect(error.cause).toBe(failure);
    expect(session.stopCalls).toBe(1);
    expect(session.discardedItems.map((item) => item.scheduleEntryId)).toEqual([
      "entry-2",
    ]);
    expect(committedEntries(session)).toEqual(["entry-1"]);
  });

  it("fails the worker when following preparation fails", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);
    session.failNextPrepare(new Error("FFmpeg process unavailable"));

    await advanceTo(setup.clock, 8_000);

    await expectSignalError(worker.completion, "packaging_failed");
    expect(session.stopCalls).toBe(1);
    expect(setup.clock.pendingTimerCount).toBe(0);
  });

  it("fails the worker when fresh selection has no current playout", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following());
    setup.provider.enqueueCurrent({
      status: "no_current",
      channelId: CHANNEL,
      scheduleRevision: 8,
      evaluatedAt: 10_000,
      reason: "schedule_gap",
    });
    const { worker, session } = await startWorker(setup);

    await advanceTo(setup.clock, 10_000);

    await expectSignalError(worker.completion, "no_current_playout");
    expect(session.stopCalls).toBe(1);
  });

  it("gives up after repeated stale recovery attempts", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following());
    setup.coordinator.setSchedule(CHANNEL, 9, []);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      setup.provider.enqueueCurrent(current(entry("entry-2", 10_000), 10_000));
    }
    const { worker, session } = await startWorker(setup);

    await advanceTo(setup.clock, 10_000);

    const error = await expectSignalError(
      worker.completion,
      "transition_failed",
    );
    expect(error.details).toMatchObject({
      reason: "recovery_attempts_exhausted",
    });
    expect(setup.coordinator.calls).toHaveLength(3);
    expect(session.discardedItems).toHaveLength(3);
    expect(session.stopCalls).toBe(1);
  });

  it("gives up when stale recovery outlasts the startup timeout", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following());
    setup.provider.enqueueCurrent(current(entry("entry-2", 10_000), 10_000));
    const coordinator: TransitionCoordinator = {
      async commitPreparedTransition() {
        setup.clock.advanceBy(5_000);
        return "stale";
      },
    };
    const { worker, session } = await startWorker(setup, {
      transitionCoordinator: coordinator,
    });

    await advanceTo(setup.clock, 10_000);

    const error = await expectSignalError(
      worker.completion,
      "transition_failed",
    );
    expect(error.details).toMatchObject({ reason: "deadline_exceeded" });
    expect(setup.provider.currentCalls).toHaveLength(3);
    expect(session.stopCalls).toBe(1);
  });

  it("stops transitioning once the session ends on its own", async () => {
    const setup = harness();
    const { worker, session } = await startWorker(setup);
    const failure = new SignalError("packaging_failed", "FFmpeg exited");

    session.rejectReady(failure);
    await expect(worker.completion).rejects.toBe(failure);
    await advanceTo(setup.clock, 10_000);

    expect(setup.provider.followingCalls).toEqual([]);
    expect(setup.clock.pendingTimerCount).toBe(0);
  });

  it("keeps waiting when a real timer fires before the boundary", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const earlyTimers: TimerScheduler = {
      setTimeout: (callback, delayMs) =>
        setup.clock.setTimeout(callback, Math.max(1, delayMs - 1)),
    };
    const { worker, session } = await startWorker(setup, {
      timers: earlyTimers,
    });

    await advanceTo(setup.clock, 7_999);
    expect(setup.provider.followingCalls).toEqual([]);
    await advanceTo(setup.clock, 9_999);
    expect(setup.coordinator.calls).toEqual([]);

    await advanceTo(setup.clock, 10_000);
    expect(committedEntries(session)).toEqual(["entry-1", "entry-2"]);

    await worker.stop();
  });

  it.each([
    ["revision", 8, "entry-2"],
    ["entry", 7, "entry-2b"],
  ])(
    "discards a preparation made stale by its %s alone",
    async (_label, revision, nextEntryId) => {
      const setup = harness();
      setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
      const fresh = entry(nextEntryId, 10_000, { scheduleRevision: revision });
      setup.coordinator.setSchedule(CHANNEL, revision, [
        entry("entry-1", 0),
        fresh,
      ]);
      setup.provider.enqueueCurrent(current(fresh, 10_000));
      const { worker, session } = await startWorker(setup);

      await advanceTo(setup.clock, 10_000);

      expect(
        session.discardedItems.map((item) => item.scheduleEntryId),
      ).toEqual(["entry-2"]);
      expect(committedEntries(session)).toEqual(["entry-1", nextEntryId]);

      await worker.stop();
    },
  );

  it("stop settles once the session ends an in-flight preparation, not at the deadline", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);
    session.pauseNextPrepare();
    await advanceTo(setup.clock, 8_000);
    expect(session.prepareCalls).toHaveLength(1);

    await worker.stop();

    expect(setup.clock.now()).toBe(8_000);
    expect(session.hasOutstandingPreparation).toBe(false);
    expect(session.unreleasedAtStop).toBe(0);
    expect(committedEntries(session)).toEqual(["entry-1"]);
    await expect(worker.completion).resolves.toBeUndefined();
    expect(setup.clock.pendingTimerCount).toBe(0);
  });

  it("discards a held preparation when the session ends on its own", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);
    await advanceTo(setup.clock, 8_000);
    const failure = new SignalError("packaging_failed", "FFmpeg exited");

    session.rejectReady(failure);
    await expect(worker.completion).rejects.toBe(failure);
    await settlePromises(5);

    expect(session.discardedItems.map((item) => item.scheduleEntryId)).toEqual([
      "entry-2",
    ]);
    expect(setup.clock.pendingTimerCount).toBe(0);
  });

  it("fails the worker when a coordinator reports a commit it never made", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const coordinator: TransitionCoordinator = {
      async commitPreparedTransition() {
        return "committed";
      },
    };
    const { worker, session } = await startWorker(setup, {
      transitionCoordinator: coordinator,
    });

    await advanceTo(setup.clock, 10_000);

    await expectSignalError(worker.completion, "transition_failed");
    expect(session.discardedItems.map((item) => item.scheduleEntryId)).toEqual([
      "entry-2",
    ]);
    expect(session.stopCalls).toBe(1);
  });
  it("stop resolves once the loop's own retry discards a preparation halt failed to release", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);
    await advanceTo(setup.clock, 8_000);
    session.failDiscards(new Error("discard failed once"));

    await expect(worker.stop()).resolves.toBeUndefined();
    expect(session.discardedItems.map((item) => item.scheduleEntryId)).toEqual([
      "entry-2",
    ]);
  });

  it("rejects a stop whose session cleanup fails and succeeds on retry", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);
    await advanceTo(setup.clock, 8_000);
    const failure = new Error("discard failed");
    session.failDiscards(failure, failure);

    await expect(worker.stop()).rejects.toBe(failure);
    await expect(worker.stop()).resolves.toBeUndefined();
    expect(session.discardedItems.map((item) => item.scheduleEntryId)).toEqual([
      "entry-2",
    ]);
  });

  it("stops the session without waiting for a slow discard", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);
    await advanceTo(setup.clock, 8_000);
    const gate = session.pauseNextDiscard();

    const stopping = worker.stop();
    expect(session.stopCalls).toBe(1);

    gate.resolve();
    await stopping;
    expect(session.discardedItems).toHaveLength(1);
  });

  it("shares an in-flight stale discard with a stop that lands during it", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    setup.coordinator.setSchedule(CHANNEL, 8, [entry("entry-1", 0)]);
    const { worker, session } = await startWorker(setup);
    await advanceTo(setup.clock, 8_000);
    const gate = session.pauseNextDiscard();

    await advanceTo(setup.clock, 10_000);
    expect(setup.coordinator.calls).toHaveLength(1);
    const stopping = worker.stop();
    gate.resolve();
    await stopping;

    expect(session.discardedItems).toHaveLength(1);
    expect(setup.provider.currentCalls).toHaveLength(2);
  });

  it.each([
    ["following", false],
    ["current", true],
  ])(
    "fails the worker with the cause when the %s lookup rejects",
    async (_label, followingSucceeds) => {
      const setup = harness();
      if (followingSucceeds) setup.provider.enqueueFollowing(following());
      const { worker } = await startWorker(setup);

      await advanceTo(setup.clock, 10_000);

      const error = await expectSignalError(
        worker.completion,
        "transition_failed",
      );
      expect(error.cause).toBeInstanceOf(Error);
    },
  );

  it("halts transitions when the session ends cleanly on its own", async () => {
    const setup = harness();
    const { worker, session } = await startWorker(setup);

    await session.stop();
    await expect(worker.completion).resolves.toBeUndefined();
    await advanceTo(setup.clock, 10_000);

    expect(setup.provider.followingCalls).toEqual([]);
    expect(setup.clock.pendingTimerCount).toBe(0);
  });
  it("commits recovery at once even when the provider clock runs ahead", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following());
    setup.provider.enqueueCurrent(current(entry("entry-2", 10_000), 12_000));
    const { worker, session } = await startWorker(setup);

    await advanceTo(setup.clock, 10_000);

    expect(committedEntries(session)).toEqual(["entry-1", "entry-2"]);
    await worker.stop();
  });

  it.each([
    ["following", false],
    ["current", true],
  ])(
    "fails the worker at its transition deadline when the %s lookup never answers",
    async (label, followingSucceeds) => {
      const setup = harness();
      if (followingSucceeds) setup.provider.enqueueFollowing(following());
      const { worker, session } = await startWorker(setup);
      const lookup = label === "following" ? "getFollowing" : "getCurrent";
      vi.spyOn(setup.provider, lookup).mockImplementation(never);
      const settled = trackSettled(worker.completion);

      await advanceTo(setup.clock, 8_000);
      await advanceTo(setup.clock, 10_000);
      await advanceTo(setup.clock, TRANSITION_DEADLINE_MS - 1);
      expect(settled()).toBe(false);

      await advanceTo(setup.clock, TRANSITION_DEADLINE_MS);
      const error = await expectSignalError(
        worker.completion,
        "transition_failed",
      );
      expect(error.details).toMatchObject({ reason: "deadline_exceeded" });
      expect(session.stopCalls).toBe(1);
      expect(setup.clock.pendingTimerCount).toBe(0);
    },
  );

  it("fails the worker when preparation outlasts its deadline and leaves no preparation behind", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const { worker, session } = await startWorker(setup);
    const gate = session.pauseNextPrepare();
    await advanceTo(setup.clock, 8_000);
    expect(session.prepareCalls).toHaveLength(1);

    await advanceTo(setup.clock, TRANSITION_DEADLINE_MS);
    const error = await expectSignalError(
      worker.completion,
      "transition_failed",
    );
    expect(error.details).toMatchObject({
      reason: "deadline_exceeded",
      step: "prepare",
    });
    expect(session.isStopped).toBe(true);

    gate.resolve();
    await settlePromises(5);
    expect(session.hasOutstandingPreparation).toBe(false);
    expect(committedEntries(session)).toEqual(["entry-1"]);
    expect(setup.clock.pendingTimerCount).toBe(0);
  });

  it("fails the worker when the coordinator never answers and refuses its late commit", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    let commit: (() => void) | undefined;
    const coordinator: TransitionCoordinator = {
      commitPreparedTransition(_candidate, callback) {
        commit = callback;
        return never();
      },
    };
    const { worker, session } = await startWorker(setup, {
      transitionCoordinator: coordinator,
    });
    await advanceTo(setup.clock, 8_000);
    await advanceTo(setup.clock, 10_000);
    expect(commit).toBeDefined();

    await advanceTo(setup.clock, TRANSITION_DEADLINE_MS);
    await expectSignalError(worker.completion, "transition_failed");

    expect(() => commit?.()).toThrow();
    expect(committedEntries(session)).toEqual(["entry-1"]);
    expect(session.discardedItems.map((item) => item.scheduleEntryId)).toEqual([
      "entry-2",
    ]);
    expect(setup.clock.pendingTimerCount).toBe(0);
  });

  it("fails the worker when a stale discard stalls, then lets session stop release it", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    setup.coordinator.setSchedule(CHANNEL, 8, [entry("entry-1", 0)]);
    const { worker, session } = await startWorker(setup);
    await advanceTo(setup.clock, 8_000);
    session.pauseNextDiscard();
    await advanceTo(setup.clock, 10_000);
    expect(setup.coordinator.calls).toHaveLength(1);
    const settled = trackSettled(worker.completion);

    await advanceTo(setup.clock, TRANSITION_DEADLINE_MS - 1);
    expect(settled()).toBe(false);
    await advanceTo(setup.clock, TRANSITION_DEADLINE_MS);
    const error = await expectSignalError(
      worker.completion,
      "transition_failed",
    );
    expect(error.details).toMatchObject({ step: "discard" });

    await expect(worker.stop()).resolves.toBeUndefined();
    expect(session.isStopped).toBe(true);
    expect(session.hasOutstandingPreparation).toBe(false);
    expect(setup.clock.pendingTimerCount).toBe(0);
  });

  it("refuses a commit callback that races the deadline before the worker halts", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const gate = new Deferred<void>();
    let refusal: unknown;
    const coordinator: TransitionCoordinator = {
      async commitPreparedTransition(_candidate, callback) {
        await gate.promise;
        try {
          callback();
        } catch (error) {
          refusal = error;
          throw error;
        }
        return "committed";
      },
    };
    const { worker, session } = await startWorker(setup, {
      transitionCoordinator: coordinator,
    });
    await advanceTo(setup.clock, 8_000);
    await advanceTo(setup.clock, 10_000);

    setup.clock.advanceTo(TRANSITION_DEADLINE_MS);
    gate.resolve();
    await settlePromises(5);

    expect(refusal).toMatchObject({
      code: "transition_failed",
      details: { reason: "deadline_exceeded", step: "commit" },
    });
    expect(committedEntries(session)).toEqual(["entry-1"]);
    await expectSignalError(worker.completion, "transition_failed");
  });

  it("bounds a stale discard by the transition deadline, not by when it started", async () => {
    const setup = harness();
    setup.provider.enqueueFollowing(following(entry("entry-2", 10_000)));
    const coordinator: TransitionCoordinator = {
      async commitPreparedTransition() {
        setup.clock.advanceBy(2_000);
        return "stale";
      },
    };
    const { worker, session } = await startWorker(setup, {
      transitionCoordinator: coordinator,
    });
    await advanceTo(setup.clock, 8_000);
    session.pauseNextDiscard();
    await advanceTo(setup.clock, 10_000);
    const settled = trackSettled(worker.completion);

    await advanceTo(setup.clock, TRANSITION_DEADLINE_MS);
    expect(settled()).toBe(true);
    await expectSignalError(worker.completion, "transition_failed");
  });

  it("stops without waiting for a lookup that never answers", async () => {
    const setup = harness();
    const { worker } = await startWorker(setup);
    vi.spyOn(setup.provider, "getFollowing").mockImplementation(never);
    await advanceTo(setup.clock, 8_000);
    expect(setup.provider.getFollowing).toHaveBeenCalledOnce();

    await expect(worker.stop()).resolves.toBeUndefined();
    await expect(worker.completion).resolves.toBeUndefined();
    expect(setup.clock.pendingTimerCount).toBe(0);
  });
});
