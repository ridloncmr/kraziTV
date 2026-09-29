import { SignalError } from "../errors.js";
import type {
  ChannelId,
  PlayoutProvider,
  ScheduleEntryId,
} from "../playout/contracts.js";
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
import type {
  TransitionCandidate,
  TransitionCoordinator,
} from "./contracts.js";
import {
  requireCurrent,
  selectContiguousFollowing,
  toFollowingSignalItem,
  toSignalItem,
} from "./playout-projection.js";

/** Stale fresh-selection commits in a row before the worker stops retrying. */
const MAX_RECOVERY_ATTEMPTS = 3;

export type TransitionLoopOptions = {
  channelId: ChannelId;
  session: SignalSession;
  playoutProvider: PlayoutProvider;
  transitionCoordinator: TransitionCoordinator;
  clock: Clock;
  timers: TimerScheduler;
  prepareLeadMs: DurationMs;
  recoveryTimeoutMs: DurationMs;
};

export type AiringItem = {
  scheduleEntryId: ScheduleEntryId;
  endsAt: TimestampMs;
};

type PlannedTransition = {
  candidate: TransitionCandidate;
  item: SignalPlayoutItem;
  endsAt: TimestampMs;
};

type TransitionStep =
  | "following_lookup"
  | "current_lookup"
  | "prepare"
  | "commit"
  | "discard"
  | "recovery";

/** Unwinds the loop quietly once the worker has halted it. */
class Halted extends Error {}

/**
 * Replaces the airing item at each scheduled boundary with selected playout.
 * It holds at most one preparation and never decides what should play.
 */
export class TransitionLoop {
  private halted = false;
  /** Cancels the current interruptible wait and lets the loop observe a halt. */
  private wake: (() => void) | undefined;
  private preparation: SignalPreparation | undefined;
  private discarding: Promise<void> | undefined;

  /** Starts from the item the worker's session is already transmitting. */
  constructor(
    private readonly options: TransitionLoopOptions,
    private airing: AiringItem,
  ) {}

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
   * dependency call shares one absolute deadline so a stalled lookup, encoder,
   * or coordinator fails the worker instead of silencing a published channel.
   */
  private async transitionOnce(): Promise<void> {
    const boundaryAt = this.airing.endsAt;
    const deadlineAt = boundaryAt + this.options.recoveryTimeoutMs;
    await this.sleepUntil(boundaryAt - this.options.prepareLeadMs);
    const following = selectContiguousFollowing(
      await this.bounded(
        "following_lookup",
        deadlineAt,
        () =>
          this.options.playoutProvider.getFollowing(
            this.options.channelId,
            this.airing.scheduleEntryId,
            1,
          ),
        { interruptible: true },
      ),
      this.options.channelId,
      boundaryAt,
    );
    this.checkHalted();

    if (following !== undefined) {
      const committed = await this.prepareAndCommit(
        {
          candidate: {
            channelId: this.options.channelId,
            scheduleEntryId: following.scheduleEntryId,
            scheduleRevision: following.scheduleRevision,
          },
          item: toFollowingSignalItem(following),
          endsAt: following.endsAt,
        },
        boundaryAt,
        deadlineAt,
      );
      if (committed) return;
    }

    await this.sleepUntil(boundaryAt);
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
      if (this.options.clock.now() >= deadlineAt) {
        throw this.deadlineError("recovery");
      }

      const committed = await this.prepareAndCommit(
        {
          candidate: {
            channelId: this.options.channelId,
            scheduleEntryId: current.item.scheduleEntryId,
            scheduleRevision: current.item.scheduleRevision,
          },
          item: toSignalItem(current, this.options.channelId),
          endsAt: current.item.endsAt,
        },
        // Already past; provider evaluatedAt is never trusted as a wait target.
        this.airing.endsAt,
        deadlineAt,
      );
      if (committed) return;
      if (this.options.clock.now() >= deadlineAt) {
        throw this.deadlineError("recovery");
      }
    }
    throw new SignalError(
      "transition_failed",
      `Channel ${this.options.channelId} could not commit fresh playout`,
      {
        channelId: this.options.channelId,
        reason: "recovery_attempts_exhausted",
      },
    );
  }

  /**
   * Prepares one item, waits for its boundary, and lets the coordinator decide.
   * Returns false after discarding a stale preparation.
   */
  private async prepareAndCommit(
    planned: PlannedTransition,
    boundaryAt: TimestampMs,
    deadlineAt: TimestampMs,
  ): Promise<boolean> {
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

    await this.sleepUntil(boundaryAt);
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
              throw new Halted("Channel worker stopped before commit");
            }
            if (this.options.clock.now() >= deadlineAt) {
              throw this.deadlineError("commit");
            }
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
        throw new SignalError(
          "transition_failed",
          `Channel ${this.options.channelId} transition was reported committed without its commit`,
          { channelId: this.options.channelId },
        );
      }
      this.airing = {
        scheduleEntryId: planned.candidate.scheduleEntryId,
        endsAt: planned.endsAt,
      };
      return true;
    }
    await this.releasePreparation(deadlineAt);
    return false;
  }

  /**
   * Waits on the injected scheduler until wall time reaches the target.
   * Real timers can fire early, so the clock, not the timer, ends the wait.
   */
  private async sleepUntil(atMs: TimestampMs): Promise<void> {
    this.checkHalted();
    while (this.options.clock.now() < atMs) {
      const delayMs = atMs - this.options.clock.now();
      await new Promise<void>((resolve) => {
        const task = this.options.timers.setTimeout(resolve, delayMs);
        this.wake = () => {
          task.cancel();
          resolve();
        };
      });
      this.wake = undefined;
      this.checkHalted();
    }
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
    if (this.options.clock.now() >= deadlineAt) {
      throw this.deadlineError(step);
    }

    const pending = operation();
    let task: ScheduledTask | undefined;
    let settleEarly!: (reason: "expired" | "halted") => void;
    const early = new Promise<"expired" | "halted">((resolve) => {
      settleEarly = resolve;
    });
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
      throw this.deadlineError(step);
    } finally {
      task?.cancel();
      if (this.wake === wake) this.wake = undefined;
    }
  }

  /** Classifies an expired dependency call as a worker-fatal transition failure. */
  private deadlineError(step: TransitionStep): SignalError {
    return new SignalError(
      "transition_failed",
      `Channel ${this.options.channelId} did not finish ${step} before its transition deadline`,
      {
        channelId: this.options.channelId,
        step,
        reason: "deadline_exceeded",
      },
    );
  }

  /**
   * Discards the held preparation through one shared attempt so halt and loop
   * unwinding never overlap. A failed or expired discard stays held for retry,
   * so a stalled encoder cannot keep stop waiting indefinitely. Inside a
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
    if (this.halted) throw new Halted("Channel worker stopped");
  }
}

/** Keeps typed packaging failures and classifies unknown preparation errors. */
function normalizePreparationError(
  cause: unknown,
  channelId: ChannelId,
): SignalError {
  if (cause instanceof SignalError) return cause;
  return new SignalError(
    "packaging_failed",
    `Signal packaging could not prepare the next item for channel ${channelId}`,
    { channelId },
    { cause },
  );
}

/** Keeps typed failures and classifies coordinator or provider errors. */
function normalizeTransitionError(
  cause: unknown,
  channelId: ChannelId,
): SignalError {
  if (cause instanceof SignalError) return cause;
  return new SignalError(
    "transition_failed",
    `Channel ${channelId} could not transition to its next playout item`,
    { channelId },
    { cause },
  );
}
