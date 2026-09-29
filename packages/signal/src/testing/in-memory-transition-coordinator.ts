import type {
  TransitionCandidate,
  TransitionCoordinator,
} from "../channel-worker/contracts.js";
import type { ChannelId, ScheduleEntryId } from "../playout/contracts.js";
import type { Clock, TimestampMs } from "../runtime/clock.js";

export type CoordinatedScheduleEntry = {
  scheduleEntryId: ScheduleEntryId;
  startsAt: TimestampMs;
  endsAt: TimestampMs;
};

type CoordinatedSchedule = {
  revision: number;
  entries: readonly CoordinatedScheduleEntry[];
};

/** Mirrors the persistence adapter's observable revalidation without SQLite. */
export class InMemoryTransitionCoordinator implements TransitionCoordinator {
  readonly calls: Array<{ candidate: TransitionCandidate; atMs: TimestampMs }> =
    [];
  private readonly schedules = new Map<ChannelId, CoordinatedSchedule>();

  /** Uses the injected clock as the coordinator's boundary time source. */
  constructor(private readonly clock: Clock) {}

  /** Replaces the persisted schedule snapshot, as a regeneration commit would. */
  setSchedule(
    channelId: ChannelId,
    revision: number,
    entries: readonly CoordinatedScheduleEntry[],
  ): void {
    this.schedules.set(channelId, { revision, entries });
  }

  /** Commits only a candidate that covers boundary time under the current revision. */
  async commitPreparedTransition(
    candidate: TransitionCandidate,
    commit: () => void,
  ): Promise<"committed" | "stale"> {
    const boundaryTime = this.clock.now();
    this.calls.push({ candidate, atMs: boundaryTime });
    const schedule = this.schedules.get(candidate.channelId);
    const covering = schedule?.entries.find(
      (entry) => entry.startsAt <= boundaryTime && boundaryTime < entry.endsAt,
    );
    if (
      schedule === undefined ||
      schedule.revision !== candidate.scheduleRevision ||
      covering?.scheduleEntryId !== candidate.scheduleEntryId
    ) {
      return "stale";
    }
    commit();
    return "committed";
  }
}
