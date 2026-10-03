import {
  assertFollowingCount,
  buildPlayoutTimeline,
  type ChannelState,
  deriveChannelState,
  type FollowingPlayout,
  selectFollowingPlayout,
} from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ScheduleLog } from "../schedules/contracts.js";
import { loadScheduleState } from "../schedules/schedule-repository.js";
import type { ScheduleService } from "../schedules/schedule-service.js";
import type {
  CoverageRequirement,
  PlayoutFailure,
  PlayoutSnapshot,
  PlayoutSnapshotOptions,
  PlayoutSnapshotRead,
  PlayoutTimeline,
} from "./contracts.js";
import {
  findCoveringPlayoutEntries,
  findPlayoutEntryById,
  listPlayoutEntriesAfter,
  listPlayoutEntriesInWindow,
} from "./playout-repository.js";
import { readPlayoutSnapshot } from "./playout-snapshot.js";

interface PlayoutServiceOptions {
  /** Passed to every snapshot; a test pause point. */
  afterRevisionRead?: PlayoutSnapshotOptions["afterRevisionRead"];
}

/**
 * The schedule writer a playout read ensures coverage through. Its clock is
 * the only clock playout reads, so a read evaluates the same time the write
 * generates coverage for.
 */
type CoverageWriter = Pick<ScheduleService, "ensureCoverage" | "now">;

/**
 * Answers what a channel transmits from schedule snapshots. Never writes SQL
 * itself: a snapshot that finds coverage short ends, `ensureCoverage` writes,
 * and exactly one more snapshot answers, so reads of a covered channel never
 * take write authority.
 */
export class PlayoutService {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #schedules: CoverageWriter;
  readonly #afterRevisionRead: PlayoutSnapshotOptions["afterRevisionRead"];

  // The snapshot hook is injectable so concurrency tests can pause a read.
  constructor(
    db: Kysely<DatabaseSchema>,
    schedules: CoverageWriter,
    options: PlayoutServiceOptions = {},
  ) {
    this.#db = db;
    this.#schedules = schedules;
    this.#afterRevisionRead = options.afterRevisionRead;
  }

  /**
   * Derives the channel's state at `at`, or now when omitted. The evaluation
   * time is fixed once, so the retry answers for the same instant, and a
   * future `at` ensures coverage through it.
   */
  async getCurrent(
    channelId: string,
    at: number | undefined,
    log: ScheduleLog,
  ): Promise<ChannelState | PlayoutFailure> {
    const evaluatedAt = at ?? this.#schedules.now();
    return this.#readCovered(channelId, log, at, async (trx, revision) =>
      deriveChannelState({
        channelId,
        scheduleRevision: revision,
        evaluatedAt,
        entries: await findCoveringPlayoutEntries(trx, channelId, evaluatedAt),
      }),
    );
  }

  /**
   * Selects up to `count` contiguous playable items after the cursor entry,
   * with a full horizon of coverage ensured first.
   */
  async getFollowing(
    channelId: string,
    afterScheduleEntryId: string,
    count: number,
    log: ScheduleLog,
  ): Promise<FollowingPlayout | PlayoutFailure> {
    // A bad count is a programming error; reject it before any coverage write.
    assertFollowingCount(count);
    return this.#readCovered(
      channelId,
      log,
      undefined,
      async (trx, revision) => {
        const cursor = await findPlayoutEntryById(
          trx,
          channelId,
          afterScheduleEntryId,
        );
        return selectFollowingPlayout({
          channelId,
          scheduleRevision: revision,
          cursor: cursor?.entry,
          candidates:
            cursor === undefined
              ? []
              : await listPlayoutEntriesAfter(
                  trx,
                  channelId,
                  cursor.sequenceNumber,
                  count,
                ),
          count,
        });
      },
    );
  }

  /**
   * Builds the playout timeline for `[start, end)` from one snapshot, with
   * coverage ensured through `end` first, so a window past the horizon is
   * never silently partial. An `end` past the request limit is refused.
   */
  async getTimeline(
    channelId: string,
    start: number,
    end: number,
    log: ScheduleLog,
  ): Promise<PlayoutTimeline | PlayoutFailure> {
    return this.#readCovered(channelId, log, end, async (trx, revision) => ({
      kind: "timeline",
      channelId,
      scheduleRevision: revision,
      items: buildPlayoutTimeline({
        channelId,
        scheduleRevision: revision,
        entries: await listPlayoutEntriesInWindow(trx, channelId, start, end),
      }),
    }));
  }

  /**
   * Reads the channel's schedule revision in one query, already atomic.
   * Returns 0 for a channel with no schedule state, including an unknown one,
   * because revisions start at 1.
   */
  async getScheduleRevision(channelId: string): Promise<number> {
    const state = await loadScheduleState(this.#db, channelId);
    return state?.scheduleRevision ?? 0;
  }

  /**
   * Runs `read` in a snapshot covering a full horizon, or `through` when
   * later. On a shortfall it ensures coverage once and retries once against
   * the first snapshot's target, so a moving clock never makes the retry
   * demand more than the write reached.
   */
  async #readCovered<T>(
    channelId: string,
    log: ScheduleLog,
    through: number | undefined,
    read: PlayoutSnapshotRead<T>,
  ): Promise<T | PlayoutFailure> {
    const first = await this.#snapshot(
      channelId,
      { kind: "horizon", through },
      read,
    );
    if (first.kind !== "coverage_needed") return unwrapSnapshot(first);

    const coverage = await this.#schedules.ensureCoverage(
      channelId,
      log,
      through,
    );
    if (coverage.kind === "covered" || coverage.kind === "unschedulable") {
      // An unschedulable channel still transmits whatever entries exist.
      const second = await this.#snapshot(
        channelId,
        coverage.kind === "covered"
          ? { kind: "target", target: first.target }
          : { kind: "none" },
        read,
      );
      return second.kind === "coverage_needed"
        ? { kind: "unavailable" }
        : unwrapSnapshot(second);
    }
    return coverage.kind === "channel_not_found"
      ? { kind: "not_found" }
      : coverage;
  }

  /** Takes one snapshot on this service's database, clock, and hook. */
  #snapshot<T>(
    channelId: string,
    coverage: CoverageRequirement,
    read: PlayoutSnapshotRead<T>,
  ): Promise<PlayoutSnapshot<T>> {
    return readPlayoutSnapshot(
      this.#db,
      channelId,
      this.#schedules.now(),
      { coverage, afterRevisionRead: this.#afterRevisionRead },
      read,
    );
  }
}

/**
 * Returns a settled snapshot's kraziBrain value, or the failure that ended
 * it; every other snapshot outcome is already a playout failure.
 */
function unwrapSnapshot<T>(
  snapshot: Exclude<PlayoutSnapshot<T>, { kind: "coverage_needed" }>,
): T | PlayoutFailure {
  return snapshot.kind === "ok" ? snapshot.value : snapshot;
}
