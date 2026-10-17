import type { ChannelId, PlayoutProvider } from "../playout/contracts.js";
import type {
  Clock,
  DurationMs,
  ScheduledTask,
  TimerScheduler,
  TimestampMs,
} from "../runtime/clock.js";
import type {
  SignalPlayoutItem,
  SignalPreparation,
  SignalSession,
} from "../signal-packager/contracts.js";
import {
  committedWithoutCommit,
  normalizePreparationError,
  normalizeTransitionError,
  recoveryAttemptsExhausted,
  transitionDeadlineExceeded,
  TransitionLoopHalted,
} from "./channel-worker-errors.js";
import type {
  AiringItem,
  TransitionCandidate,
  TransitionCoordinator,
  TransitionStep,
} from "./contracts.js";
import {
  cursorOf,
  findMovedEnd,
  requireCurrent,
  selectContiguousFollowing,
  toFollowingSignalItem,
  toSignalItem,
} from "./playout-projection.js";

/** Stale fresh-selection commits in a row before the worker stops retrying. */
const MAX_RECOVERY_ATTEMPTS = 3;

type TransitionLoopOptions = {
  channelId: ChannelId;
  session: SignalSession;
  playoutProvider: PlayoutProvider;
  transitionCoordinator: TransitionCoordinator;
  clock: Clock;
  timers: TimerScheduler;
  prepareLeadMs: DurationMs;
  recoveryTimeoutMs: DurationMs;
};

type PlannedTransition = {
  candidate: TransitionCandidate;
  item: SignalPlayoutItem;
  endsAt: TimestampMs;
};

/**
 * Replaces the airing item at each scheduled boundary with selected playout.
 * It holds at most one preparation and never decides what should play.
 */
export class TransitionLoop {
  private halted = false;
  /** Cancels the current interruptible wait and lets the loop observe a halt. */
  private wake: (() => void) | undefined;
  /** Set by a schedule-change notice until a boundary wait re-reads the airing item. */
  private scheduleChangeNoticed = false;
  /** Ends only a boundary wait, never a dependency call, when a notice arrives. */
  private wakeForScheduleChange: (() => void) | undefined;
  private preparation: SignalPreparation | undefined;
  private discarding: Promise<void> | undefined;
  /**
   * The end the airing item's FFmpeg process was started for, which a cut
   * never changes, so a withdrawn cut can move the boundary back to it.
   */
  private playsUntil: TimestampMs;

  /** Starts from the item the worker's session is already transmitting. */
  constructor(
    private readonly options: TransitionLoopOptions,
    private airing: AiringItem,
  ) {
    this.playsUntil = airing.endsAt;
  }

  /**
   * Runs until halted, rejecting only with a failure fatal to the worker. A
   * failure is reported without waiting on the discard it starts, because the
   * worker's stop awaits that discard and a stalled one must not extend the
   * expired item. A halt retries the discard that halt itself could not finish.
   */
  async run(): Promise<void> {
    try {
      while (true) {
        await this.transitionOnce();
      }
    } catch (error) {
      if (this.halted) {
        await this.releasePreparation().catch(() => undefined);
        return;
      }
      void this.releasePreparation().catch(() => undefined);
      throw normalizeTransitionError(error, this.options.channelId);
    }
  }

  /** Reports whether a preparation still awaits a successful discard. */
  get holdsPreparation(): boolean {
    return this.preparation !== undefined;
  }

  /**
   * Notes that the channel's schedule changed so the next boundary wait
   * re-reads the airing item's end (ADR 0015). A notice that lands during a
   * lookup or preparation waits for that wait instead of failing the call.
   */
  scheduleChanged(): void {
    this.scheduleChangeNoticed = true;
    this.wakeForScheduleChange?.();
  }

  /** Stops future work and releases any preparation the loop still holds. */
  async halt(): Promise<void> {
    this.halted = true;
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
    await this.releasePreparation();
  }

  /**
   * Crosses one boundary, falling back to fresh selection when stale. Every
   * dependency call shares one absolute deadline so a stalled lookup, FFmpeg process,
   * or coordinator fails the worker instead of silencing a published channel.
   */
  private async transitionOnce(): Promise<void> {
    const boundaryAt = this.airing.endsAt;
    const deadlineAt = boundaryAt + this.options.recoveryTimeoutMs;
    // A boundary already past, such as a cut the notice found behind it,
    // joins what airs now at its offset instead of airing the next item late.
    if (boundaryAt <= this.options.clock.now()) {
      await this.recover(deadlineAt);
      return;
    }
    const leadAt = boundaryAt - this.options.prepareLeadMs;
    if ((await this.sleepUntilCut(leadAt, deadlineAt)) === "cut") return;
    const following = selectContiguousFollowing(
      await this.bounded(
        "following_lookup",
        deadlineAt,
        () =>
          this.options.playoutProvider.getFollowing(
            this.options.channelId,
            this.airing.cursor,
            1,
          ),
        { interruptible: true },
      ),
      this.options.channelId,
      boundaryAt,
    );
    this.checkHalted();

    if (following !== undefined) {
      const outcome = await this.prepareAndCommit(
        {
          candidate: {
            channelId: this.options.channelId,
            cursor: cursorOf(following),
            scheduleRevision: following.scheduleRevision,
          },
          item: toFollowingSignalItem(following),
          endsAt: following.endsAt,
        },
        boundaryAt,
        deadlineAt,
      );
      if (outcome !== "stale") return;
    }

    if ((await this.sleepUntilCut(boundaryAt, deadlineAt)) === "cut") return;
    await this.recover(deadlineAt);
  }

  /** Commits the playout airing now, bounded by attempts and the deadline. */
  private async recover(deadlineAt: TimestampMs): Promise<void> {
    for (let attempt = 0; attempt < MAX_RECOVERY_ATTEMPTS; attempt += 1) {
      const current = requireCurrent(
        await this.bounded(
          "current_lookup",
          deadlineAt,
          () =>
            this.options.playoutProvider.getCurrent(
              this.options.channelId,
              this.options.clock.now(),
            ),
          { interruptible: true },
        ),
        this.options.channelId,
      );
      this.checkHalted();
      this.checkDeadline("recovery", deadlineAt);

      const outcome = await this.prepareAndCommit(
        {
          candidate: {
            channelId: this.options.channelId,
            cursor: cursorOf(current.item),
            scheduleRevision: current.item.scheduleRevision,
          },
          item: toSignalItem(current, this.options.channelId),
          endsAt: current.item.endsAt,
        },
        // Already past; provider evaluatedAt is never trusted as a wait target.
        this.airing.endsAt,
        deadlineAt,
      );
      if (outcome !== "stale") return;
      this.checkDeadline("recovery", deadlineAt);
    }
    throw recoveryAttemptsExhausted(this.options.channelId);
  }

  /**
   * Prepares one item, waits for its boundary, and lets the coordinator decide.
   * Returns "stale" after discarding a stale preparation, and "cut" after
   * discarding one whose boundary a schedule-change notice moved.
   */
  private async prepareAndCommit(
    planned: PlannedTransition,
    boundaryAt: TimestampMs,
    deadlineAt: TimestampMs,
  ): Promise<"committed" | "stale" | "cut"> {
    let preparation: SignalPreparation;
    try {
      // Not interruptible: stopping the session ends an in-flight prepare
      // (SignalSession.stop contract), so halting never abandons its result.
      preparation = await this.bounded(
        "prepare",
        deadlineAt,
        () => this.options.session.prepare(planned.item),
        { interruptible: false },
      );
    } catch (cause) {
      throw normalizePreparationError(cause, this.options.channelId);
    }
    this.preparation = preparation;
    this.checkHalted();

    if ((await this.sleepUntilCut(boundaryAt, deadlineAt)) === "cut") {
      await this.releasePreparation(deadlineAt);
      return "cut";
    }
    const outcome = await this.bounded(
      "commit",
      deadlineAt,
      () =>
        this.options.transitionCoordinator.commitPreparedTransition(
          planned.candidate,
          () => {
            // The clock, not loop bookkeeping, refuses a late callback: the
            // loop may not have observed its own expiry yet.
            if (this.halted) {
              throw new TransitionLoopHalted(
                "Channel worker stopped before commit",
              );
            }
            this.checkDeadline("commit", deadlineAt);
            preparation.commit();
            if (this.preparation === preparation) {
              this.preparation = undefined;
            }
          },
        ),
      { interruptible: true },
    );
    this.checkHalted();

    if (outcome === "committed") {
      if (this.preparation === preparation) {
        throw committedWithoutCommit(this.options.channelId);
      }
      this.airing = {
        cursor: planned.candidate.cursor,
        endsAt: planned.endsAt,
      };
      this.playsUntil = planned.endsAt;
      return "committed";
    }
    await this.releasePreparation(deadlineAt);
    return "stale";
  }

  /**
   * Waits for a boundary, ending early only when a schedule-change notice
   * moved the airing item's end; a notice that changed nothing keeps waiting.
   * The lookup is bounded by the recovery window from now, not from a
   * boundary that may be hours away, so a stalled one fails promptly.
   */
  private async sleepUntilCut(
    atMs: TimestampMs,
    deadlineAt: TimestampMs,
  ): Promise<"elapsed" | "cut"> {
    while ((await this.sleepUntil(atMs)) === "schedule_changed") {
      const at = this.options.clock.now();
      const result = await this.bounded(
        "current_lookup",
        Math.min(deadlineAt, at + this.options.recoveryTimeoutMs),
        () =>
          this.options.playoutProvider.getCurrent(this.options.channelId, at),
        { interruptible: true },
      );
      this.checkHalted();
      const moved = findMovedEnd(
        result,
        this.options.channelId,
        this.airing,
        this.playsUntil,
        at,
      );
      if (moved !== undefined) {
        this.airing = moved;
        return "cut";
      }
    }
    return "elapsed";
  }

  /**
   * Waits on the injected scheduler until wall time reaches the target.
   * Real timers can fire early, so the clock, not the timer, ends the wait.
   * A pending or arriving schedule-change notice also ends it.
   */
  private async sleepUntil(
    atMs: TimestampMs,
  ): Promise<"elapsed" | "schedule_changed"> {
    this.checkHalted();
    while (this.options.clock.now() < atMs) {
      if (this.scheduleChangeNoticed) {
        this.scheduleChangeNoticed = false;
        return "schedule_changed";
      }
      const delayMs = atMs - this.options.clock.now();
      await new Promise<void>((resolve) => {
        const task = this.options.timers.setTimeout(resolve, delayMs);
        this.wake = () => {
          task.cancel();
          resolve();
        };
        this.wakeForScheduleChange = this.wake;
      });
      this.wake = undefined;
      this.wakeForScheduleChange = undefined;
      this.checkHalted();
    }
    return "elapsed";
  }

  /**
   * Waits for one dependency call until an absolute deadline. Like sleeps, the
   * clock rather than the timer decides expiry, so an early timer re-arms.
   * Only an interruptible wait also ends when the loop halts.
   */
  private async bounded<T>(
    step: TransitionStep,
    deadlineAt: TimestampMs,
    operation: () => Promise<T>,
    { interruptible }: { interruptible: boolean },
  ): Promise<T> {
    if (interruptible) this.checkHalted();
    this.checkDeadline(step, deadlineAt);

    const pending = operation();
    let task: ScheduledTask | undefined;
    const { promise: early, resolve: settleEarly } = Promise.withResolvers<
      "expired" | "halted"
    >();
    const arm = (): void => {
      task = this.options.timers.setTimeout(() => {
        if (this.options.clock.now() < deadlineAt) arm();
        else settleEarly("expired");
      }, deadlineAt - this.options.clock.now());
    };
    arm();
    const wake = (): void => {
      task?.cancel();
      settleEarly("halted");
    };
    if (interruptible) this.wake = wake;

    try {
      const result = await Promise.race([
        pending.then((value) => ({ value })),
        early,
      ]);
      if (typeof result === "object") return result.value;
      void pending.catch(() => undefined);
      if (result === "halted") this.checkHalted();
      throw transitionDeadlineExceeded(this.options.channelId, step);
    } finally {
      task?.cancel();
      if (this.wake === wake) this.wake = undefined;
    }
  }

  /** Fails the transition once wall time reaches its shared deadline. */
  private checkDeadline(step: TransitionStep, deadlineAt: TimestampMs): void {
    if (this.options.clock.now() >= deadlineAt) {
      throw transitionDeadlineExceeded(this.options.channelId, step);
    }
  }

  /**
   * Discards the held preparation through one shared attempt so halt and loop
   * unwinding never overlap. A failed or expired discard stays held for retry,
   * so a stalled FFmpeg process cannot keep stop waiting indefinitely. Inside a
   * transition the discard shares that transition's deadline.
   */
  private releasePreparation(
    deadlineAt = this.options.clock.now() + this.options.recoveryTimeoutMs,
  ): Promise<void> {
    const preparation = this.preparation;
    if (this.discarding === undefined && preparation !== undefined) {
      const attempt = preparation.discard().then(() => {
        if (this.preparation === preparation) this.preparation = undefined;
      });
      this.discarding = attempt;
      void attempt
        .finally(() => {
          if (this.discarding === attempt) this.discarding = undefined;
        })
        .catch(() => undefined);
    }
    const discarding = this.discarding;
    if (discarding === undefined) return Promise.resolve();
    return this.bounded("discard", deadlineAt, () => discarding, {
      interruptible: false,
    });
  }

  /** Converts a halt observed after any await into quiet unwinding. */
  private checkHalted(): void {
    if (this.halted) throw new TransitionLoopHalted("Channel worker stopped");
  }
}
