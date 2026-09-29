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

/** Unwinds the loop quietly once the worker has halted it. */
class Halted extends Error {}

/**
 * Replaces the airing item at each scheduled boundary with selected playout.
 * It holds at most one preparation and never decides what should play.
 */
export class TransitionLoop {
  private halted = false;
  private wake: { task: ScheduledTask; resolve: () => void } | undefined;
  private preparation: SignalPreparation | undefined;
  private discarding: Promise<void> | undefined;

  /** Starts from the item the worker's session is already transmitting. */
  constructor(
    private readonly options: TransitionLoopOptions,
    private airing: AiringItem,
  ) {}

  /** Runs until halted, rejecting only with a failure fatal to the worker. */
  async run(): Promise<void> {
    try {
      while (true) {
        await this.transitionOnce();
      }
    } catch (error) {
      if (this.halted) return;
      throw normalizeTransitionError(error, this.options.channelId);
    } finally {
      await this.releasePreparation().catch(() => undefined);
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
    wake?.task.cancel();
    wake?.resolve();
    await this.releasePreparation();
  }

  /** Crosses one boundary, falling back to fresh selection when stale. */
  private async transitionOnce(): Promise<void> {
    const boundaryAt = this.airing.endsAt;
    await this.sleepUntil(boundaryAt - this.options.prepareLeadMs);
    const following = selectContiguousFollowing(
      await this.options.playoutProvider.getFollowing(
        this.options.channelId,
        this.airing.scheduleEntryId,
        1,
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
      );
      if (committed) return;
    }

    await this.sleepUntil(boundaryAt);
    await this.recover();
  }

  /** Commits the playout airing now, bounded by attempts and wall time. */
  private async recover(): Promise<void> {
    const deadlineAt =
      this.options.clock.now() + this.options.recoveryTimeoutMs;
    for (let attempt = 0; attempt < MAX_RECOVERY_ATTEMPTS; attempt += 1) {
      const current = requireCurrent(
        await this.options.playoutProvider.getCurrent(
          this.options.channelId,
          this.options.clock.now(),
        ),
        this.options.channelId,
      );
      this.checkHalted();
      if (this.options.clock.now() >= deadlineAt) break;

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
      );
      if (committed) return;
      if (this.options.clock.now() >= deadlineAt) break;
    }
    throw new SignalError(
      "transition_failed",
      `Channel ${this.options.channelId} could not commit fresh playout`,
      { channelId: this.options.channelId },
    );
  }

  /**
   * Prepares one item, waits for its boundary, and lets the coordinator decide.
   * Returns false after discarding a stale preparation.
   */
  private async prepareAndCommit(
    planned: PlannedTransition,
    boundaryAt: TimestampMs,
  ): Promise<boolean> {
    let preparation: SignalPreparation;
    try {
      preparation = await this.options.session.prepare(planned.item);
    } catch (cause) {
      throw normalizePreparationError(cause, this.options.channelId);
    }
    this.preparation = preparation;
    this.checkHalted();

    await this.sleepUntil(boundaryAt);
    const outcome =
      await this.options.transitionCoordinator.commitPreparedTransition(
        planned.candidate,
        () => {
          if (this.halted) {
            throw new Halted("Channel worker stopped before commit");
          }
          preparation.commit();
          if (this.preparation === preparation) this.preparation = undefined;
        },
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
    await this.releasePreparation();
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
        this.wake = {
          task: this.options.timers.setTimeout(resolve, delayMs),
          resolve,
        };
      });
      this.wake = undefined;
      this.checkHalted();
    }
  }

  /**
   * Discards the held preparation through one shared attempt so halt and loop
   * unwinding never overlap; a failed discard stays held for retry.
   */
  private releasePreparation(): Promise<void> {
    if (this.discarding !== undefined) return this.discarding;
    const preparation = this.preparation;
    if (preparation === undefined) return Promise.resolve();

    const attempt = preparation.discard().then(() => {
      if (this.preparation === preparation) this.preparation = undefined;
    });
    this.discarding = attempt;
    void attempt
      .finally(() => {
        if (this.discarding === attempt) this.discarding = undefined;
      })
      .catch(() => undefined);
    return attempt;
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
