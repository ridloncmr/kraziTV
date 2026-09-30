import { describe, expect, it, vi } from "vitest";

import type {
  ChannelId,
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  PlayoutProvider,
  ScheduleEntryId,
} from "../playout/contracts.js";
import { SignalError } from "../errors.js";
import { FakeClock } from "../testing/fake-clock.js";
import { Deferred } from "../testing/deferred.js";
import { FakeSignalPackager } from "../testing/fake-signal-packager.js";
import { ChannelWorker } from "./channel-worker.js";
import { DefaultChannelWorkerFactory } from "./default-channel-worker-factory.js";
import { WorkerCreationCleanupError } from "./worker-creation-cleanup-error.js";

const currentItem = (
  evaluatedAt: number,
  overrides: Partial<Extract<CurrentPlayoutResult, { status: "current" }>> = {},
): Extract<CurrentPlayoutResult, { status: "current" }> => ({
  status: "current",
  channelId: "channel-1",
  scheduleRevision: 7,
  evaluatedAt,
  mediaOffsetMs: evaluatedAt + 500,
  item: {
    channelId: "channel-1",
    scheduleEntryId: "entry-1",
    scheduleRevision: 7,
    mediaItemId: "media-1",
    mediaPath: "C:/media/movie.mkv",
    hasAudio: true,
    title: "Movie",
    startsAt: 0,
    endsAt: 10_000,
    durationMs: 10_500,
    startOffsetMs: 500,
  },
  ...overrides,
});

class DeferredFirstPlayoutProvider implements PlayoutProvider {
  readonly calls: Array<{ channelId: string; atMs: number }> = [];
  readonly firstResult = new Deferred<CurrentPlayoutResult>();

  constructor(private readonly finalResult: CurrentPlayoutResult) {}

  /** Lets a test advance wall time while preliminary worker setup is pending. */
  async getCurrent(
    channelId: string,
    atMs: number,
  ): Promise<CurrentPlayoutResult> {
    this.calls.push({ channelId, atMs });
    if (this.calls.length === 1) return this.firstResult.promise;
    return this.finalResult;
  }

  /** Following selection belongs to SIG-008, not worker startup. */
  async getFollowing(): Promise<never> {
    throw new Error("Unexpected following lookup");
  }

  /** Revision lookup is not needed because current results are atomic. */
  async getScheduleRevision(): Promise<never> {
    throw new Error("Unexpected revision lookup");
  }
}

class SequencePlayoutProvider implements PlayoutProvider {
  readonly calls: Array<{ channelId: string; atMs: number }> = [];

  constructor(private readonly results: CurrentPlayoutResult[]) {}

  /** Returns arranged atomic snapshots in lookup order. */
  async getCurrent(
    channelId: ChannelId,
    atMs: number,
  ): Promise<CurrentPlayoutResult> {
    this.calls.push({ channelId, atMs });
    const result = this.results.shift();
    if (result === undefined) throw new Error("No current result was arranged");
    return result;
  }

  /** Following selection belongs to SIG-008, not worker startup. */
  async getFollowing(
    _channelId: ChannelId,
    _afterScheduleEntryId: ScheduleEntryId,
    _count: number,
  ): Promise<FollowingPlayoutResult> {
    throw new Error("Unexpected following lookup");
  }

  /** Revision lookup is not needed because current results are atomic. */
  async getScheduleRevision(_channelId: ChannelId): Promise<number> {
    throw new Error("Unexpected revision lookup");
  }
}

const workerOptions = (
  playoutProvider: PlayoutProvider,
  packager: FakeSignalPackager,
  clock: FakeClock,
) => ({
  playoutProvider,
  packager,
  clock,
  timers: clock,
  transitionCoordinator: {
    async commitPreparedTransition(): Promise<never> {
      throw new Error("Transitions belong to channel-worker-transitions tests");
    },
  },
  prepareLeadMs: 2_000,
  startupTimeoutMs: 5_000,
  subscriberBufferLimitBytes: 1_024,
  retentionLimitBytes: 1_024,
  findJoinPoint: (retainedBytes: Buffer) =>
    retainedBytes.indexOf("INIT") === -1
      ? undefined
      : retainedBytes.indexOf("INIT"),
});

const settlePromises = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

const expectSignalError = async (
  promise: Promise<unknown>,
  code: SignalError["code"],
): Promise<SignalError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SignalError);
    expect(error).toMatchObject({ code });
    return error as SignalError;
  }
  throw new Error(`Expected ${code}`);
};

describe("ChannelWorker startup", () => {
  it("starts from the final wall-clock snapshot without shifting the scheduled end", async () => {
    const clock = new FakeClock(1_000);
    const packager = new FakeSignalPackager();
    const provider = new DeferredFirstPlayoutProvider(currentItem(1_250));
    const abort = new AbortController();

    const factory = new DefaultChannelWorkerFactory(
      workerOptions(provider, packager, clock),
    );
    const starting = factory.create("channel-1", abort.signal);
    expect(provider.calls).toEqual([{ channelId: "channel-1", atMs: 1_000 }]);

    clock.advanceBy(250);
    provider.firstResult.resolve(currentItem(1_000));
    await settlePromises();

    expect(provider.calls).toEqual([
      { channelId: "channel-1", atMs: 1_000 },
      { channelId: "channel-1", atMs: 1_250 },
    ]);
    expect(packager.startCalls).toEqual([
      {
        channelId: "channel-1",
        scheduleEntryId: "entry-1",
        mediaItemId: "media-1",
        mediaPath: "C:/media/movie.mkv",
        hasAudio: true,
        mediaOffsetMs: 1_750,
        playDurationMs: 8_750,
      },
    ]);

    const session = packager.sessions[0];
    expect(session).toBeDefined();
    session?.pushOutput("INIT-usable-output");
    session?.resolveReady();

    const worker = await starting;
    expect(worker.channelId).toBe("channel-1");
    expect(worker.broadcaster.hasJoinableInitialization).toBe(true);

    const firstStop = worker.stop();
    const secondStop = worker.stop();
    expect(secondStop).toBe(firstStop);
    await firstStop;
    await expect(worker.completion).resolves.toBeUndefined();
    expect(session?.stopCalls).toBe(1);
  });

  it("retries session cleanup after a shared stop attempt fails", async () => {
    const clock = new FakeClock(1_000);
    const packager = new FakeSignalPackager();
    const provider = new SequencePlayoutProvider([
      currentItem(1_000),
      currentItem(1_000),
    ]);
    const starting = ChannelWorker.start(
      "channel-1",
      new AbortController().signal,
      workerOptions(provider, packager, clock),
    );
    await settlePromises();
    const session = packager.sessions[0];
    expect(session).toBeDefined();
    session?.pushOutput("INIT-retained");
    session?.resolveReady();
    const worker = await starting;
    const cleanupFailure = new Error("cleanup failed");
    const stopSession = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(cleanupFailure)
      .mockResolvedValue(undefined);
    if (session !== undefined) session.stop = stopSession;

    const first = worker.stop();
    const concurrent = worker.stop();
    expect(concurrent).toBe(first);
    await expect(first).rejects.toBe(cleanupFailure);

    const retry = worker.stop();
    const concurrentRetry = worker.stop();
    expect(retry).not.toBe(first);
    expect(concurrentRetry).toBe(retry);
    await expect(retry).resolves.toBeUndefined();
    expect(worker.stop()).toBe(retry);
    expect(stopSession).toHaveBeenCalledTimes(2);
  });

  it("waits for joinable bytes to be retained after session readiness", async () => {
    const clock = new FakeClock(1_000);
    const packager = new FakeSignalPackager();
    const provider = new SequencePlayoutProvider([
      currentItem(1_000),
      currentItem(1_000),
    ]);
    const starting = ChannelWorker.start(
      "channel-1",
      new AbortController().signal,
      workerOptions(provider, packager, clock),
    );
    let settled = false;
    void starting.then(() => {
      settled = true;
    });
    await settlePromises();

    packager.sessions[0]?.resolveReady();
    await settlePromises();
    expect(settled).toBe(false);

    packager.sessions[0]?.pushOutput("INIT-retained");
    const worker = await starting;
    expect(worker.broadcaster.hasJoinableInitialization).toBe(true);
    await worker.stop();
  });

  it("stops an item that expires before readiness and retries fresh state", async () => {
    const clock = new FakeClock(0);
    const packager = new FakeSignalPackager();
    const first = currentItem(0, {
      mediaOffsetMs: 500,
      item: {
        ...currentItem(0).item,
        endsAt: 100,
      },
    });
    const second = currentItem(100, {
      mediaOffsetMs: 600,
      item: {
        ...currentItem(100).item,
        scheduleEntryId: "entry-2",
        mediaItemId: "media-2",
        endsAt: 1_000,
      },
    });
    const provider = new SequencePlayoutProvider([first, first, second]);
    const starting = ChannelWorker.start(
      "channel-1",
      new AbortController().signal,
      workerOptions(provider, packager, clock),
    );
    await settlePromises();

    clock.advanceTo(100);
    await settlePromises();

    expect(packager.sessions[0]?.stopCalls).toBe(1);
    expect(packager.startCalls).toHaveLength(2);
    expect(packager.startCalls[1]).toMatchObject({
      scheduleEntryId: "entry-2",
      mediaOffsetMs: 600,
      playDurationMs: 900,
    });

    packager.sessions[1]?.pushOutput("INIT-next");
    packager.sessions[1]?.resolveReady();
    const worker = await starting;
    await worker.stop();
  });

  it("rechecks the absolute item deadline after readiness wins the race", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeClock(0);
    const packager = new FakeSignalPackager();
    const first = currentItem(0, {
      mediaOffsetMs: 500,
      item: {
        ...currentItem(0).item,
        endsAt: 100,
      },
    });
    const second = currentItem(100, {
      mediaOffsetMs: 600,
      item: {
        ...currentItem(100).item,
        scheduleEntryId: "entry-2",
        mediaItemId: "media-2",
        endsAt: 1_000,
      },
    });
    const provider = new SequencePlayoutProvider([first, first, second]);
    const starting = ChannelWorker.start(
      "channel-1",
      new AbortController().signal,
      { ...workerOptions(provider, packager, clock), timers },
    );
    await settlePromises();

    packager.sessions[0]?.pushOutput("INIT-expiring");
    packager.sessions[0]?.resolveReady();
    clock.advanceTo(100);
    await settlePromises();

    expect(packager.sessions[0]?.stopCalls).toBe(1);
    expect(packager.startCalls).toHaveLength(2);
    expect(packager.startCalls[1]).toMatchObject({
      scheduleEntryId: "entry-2",
      playDurationMs: 900,
    });

    packager.sessions[1]?.pushOutput("INIT-next");
    packager.sessions[1]?.resolveReady();
    const worker = await starting;
    await worker.stop();
  });

  it("stops the session and rejects when the overall startup timeout wins", async () => {
    const clock = new FakeClock(0);
    const packager = new FakeSignalPackager();
    const provider = new SequencePlayoutProvider([
      currentItem(0),
      currentItem(0),
    ]);
    const starting = ChannelWorker.start(
      "channel-1",
      new AbortController().signal,
      { ...workerOptions(provider, packager, clock), startupTimeoutMs: 250 },
    );
    const rejected = expectSignalError(starting, "worker_startup_timeout");
    await settlePromises();

    packager.sessions[0]?.resolveReady();
    clock.advanceTo(250);

    await rejected;
    expect(packager.sessions[0]?.stopCalls).toBe(1);
    expect(clock.pendingTimerCount).toBe(0);
  });

  it("rechecks the absolute startup deadline after readiness wins the race", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeClock(0);
    const packager = new FakeSignalPackager();
    const provider = new SequencePlayoutProvider([
      currentItem(0),
      currentItem(0),
    ]);
    const starting = ChannelWorker.start(
      "channel-1",
      new AbortController().signal,
      {
        ...workerOptions(provider, packager, clock),
        timers,
        startupTimeoutMs: 250,
      },
    );
    const rejected = expectSignalError(starting, "worker_startup_timeout");
    await settlePromises();

    packager.sessions[0]?.pushOutput("INIT-ready");
    packager.sessions[0]?.resolveReady();
    clock.advanceTo(250);

    await rejected;
    expect(packager.sessions[0]?.stopCalls).toBe(1);
    expect(timers.pendingTimerCount).toBe(0);
  });

  it("stops a pending session when startup is cancelled", async () => {
    const clock = new FakeClock(0);
    const packager = new FakeSignalPackager();
    const provider = new SequencePlayoutProvider([
      currentItem(0),
      currentItem(0),
    ]);
    const abort = new AbortController();
    const starting = ChannelWorker.start(
      "channel-1",
      abort.signal,
      workerOptions(provider, packager, clock),
    );
    const rejected = expectSignalError(starting, "subscription_aborted");
    await settlePromises();

    abort.abort();

    await rejected;
    expect(packager.sessions[0]?.stopCalls).toBe(1);
    expect(clock.pendingTimerCount).toBe(0);
  });

  it("does not begin preliminary work when already cancelled", async () => {
    const clock = new FakeClock(0);
    const packager = new FakeSignalPackager();
    const provider = new SequencePlayoutProvider([currentItem(0)]);
    const abort = new AbortController();
    abort.abort();

    await expectSignalError(
      ChannelWorker.start(
        "channel-1",
        abort.signal,
        workerOptions(provider, packager, clock),
      ),
      "subscription_aborted",
    );

    expect(provider.calls).toHaveLength(0);
    expect(packager.startCalls).toHaveLength(0);
    expect(clock.pendingTimerCount).toBe(0);
  });

  it("stops the session and preserves a typed readiness failure", async () => {
    const clock = new FakeClock(0);
    const packager = new FakeSignalPackager();
    const provider = new SequencePlayoutProvider([
      currentItem(0),
      currentItem(0),
    ]);
    const starting = ChannelWorker.start(
      "channel-1",
      new AbortController().signal,
      workerOptions(provider, packager, clock),
    );
    const rejected = expectSignalError(starting, "packaging_failed");
    await settlePromises();

    packager.sessions[0]?.rejectReady(
      new SignalError("packaging_failed", "Arranged packaging failure"),
    );

    await rejected;
    expect(packager.sessions[0]?.stopCalls).toBe(1);
    expect(clock.pendingTimerCount).toBe(0);
  });

  it("retains a retry handle when cleanup fails during worker startup", async () => {
    const clock = new FakeClock(0);
    const packager = new FakeSignalPackager();
    const provider = new SequencePlayoutProvider([
      currentItem(0),
      currentItem(0),
    ]);
    const starting = ChannelWorker.start(
      "channel-1",
      new AbortController().signal,
      workerOptions(provider, packager, clock),
    );
    await settlePromises();
    const session = packager.sessions[0];
    expect(session).toBeDefined();
    const cleanupFailure = new SignalError(
      "runtime_cleanup_failed",
      "arranged startup cleanup failure",
    );
    const stop = vi
      .spyOn(session!, "stop")
      .mockRejectedValueOnce(cleanupFailure)
      .mockResolvedValueOnce(undefined);

    session!.rejectReady(
      new SignalError("packaging_failed", "arranged readiness failure"),
    );

    let failure: unknown;
    try {
      await starting;
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(WorkerCreationCleanupError);
    await (failure as WorkerCreationCleanupError).retryCleanup();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("stops the session when join-point initialization throws", async () => {
    const clock = new FakeClock(0);
    const packager = new FakeSignalPackager();
    const provider = new SequencePlayoutProvider([
      currentItem(0),
      currentItem(0),
    ]);

    await expectSignalError(
      ChannelWorker.start("channel-1", new AbortController().signal, {
        ...workerOptions(provider, packager, clock),
        findJoinPoint: () => {
          throw new Error("arranged join-point failure");
        },
      }),
      "packaging_failed",
    );

    expect(packager.sessions[0]?.stopCalls).toBe(1);
    expect(clock.pendingTimerCount).toBe(0);
  });

  it("times out a preliminary lookup without creating a session", async () => {
    const clock = new FakeClock(0);
    const packager = new FakeSignalPackager();
    const provider = new DeferredFirstPlayoutProvider(currentItem(0));
    const starting = ChannelWorker.start(
      "channel-1",
      new AbortController().signal,
      { ...workerOptions(provider, packager, clock), startupTimeoutMs: 100 },
    );
    const rejected = expectSignalError(starting, "worker_startup_timeout");

    clock.advanceTo(100);

    await rejected;
    expect(packager.startCalls).toHaveLength(0);
    expect(clock.pendingTimerCount).toBe(0);
  });

  it.each([
    ["schedule_gap", "no_current_playout"],
    ["media_unavailable", "media_unavailable"],
  ] as const)(
    "rejects %s before creating a packaging session",
    async (reason, code) => {
      const clock = new FakeClock(0);
      const packager = new FakeSignalPackager();
      const provider = new SequencePlayoutProvider([
        currentItem(0),
        {
          status: "no_current",
          channelId: "channel-1",
          scheduleRevision: 7,
          evaluatedAt: 0,
          reason,
        },
      ]);

      await expectSignalError(
        ChannelWorker.start(
          "channel-1",
          new AbortController().signal,
          workerOptions(provider, packager, clock),
        ),
        code,
      );
      expect(packager.startCalls).toHaveLength(0);
      expect(provider.calls).toHaveLength(2);
      expect(clock.pendingTimerCount).toBe(0);
    },
  );
});
