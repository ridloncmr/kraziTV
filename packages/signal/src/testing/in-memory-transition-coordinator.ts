import type {
  TransitionCandidate,
  TransitionCoordinator,
} from "../channel-worker/contracts.js";
import type { ChannelId, ScheduleEntryId } from "../playout/contracts.js";
import type { Clock, TimestampMs } from "../runtime/clock.js";

/** One persisted program, or one derived filler, as revalidation sees it. */
export type CoordinatedScheduleEntry =
  | {
      kind: "program";
      scheduleEntryId: ScheduleEntryId;
      startsAt: TimestampMs;
      endsAt: TimestampMs;
    }
  | { kind: "filler"; startsAt: TimestampMs; endsAt: TimestampMs };

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

  /**
   * Commits only a candidate that covers boundary time under the current
   * revision: a program by its entry, a filler by its end.
   */
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
    const { cursor } = candidate;
    const matches =
      covering?.kind === "program"
        ? cursor.kind === "program" &&
          covering.scheduleEntryId === cursor.scheduleEntryId
        : covering?.kind === "filler" &&
          cursor.kind === "filler" &&
          covering.endsAt === cursor.endsAt;
    if (
      schedule === undefined ||
      schedule.revision !== candidate.scheduleRevision ||
      !matches
    ) {
      return "stale";
    }
    commit();
    return "committed";
  }
}
