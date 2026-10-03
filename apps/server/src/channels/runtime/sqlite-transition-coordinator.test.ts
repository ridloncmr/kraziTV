import { setTimeout as delay } from "node:timers/promises";

import type { TransitionCandidate } from "@krazitv/signal";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import {
  type ImmediateTransactionHooks,
  WriteAuthorityBusyError,
} from "../../database/writes/immediate-transaction.js";
import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import { holdWriteAuthority } from "../../testing/hold-write-authority.js";
import { manualClock } from "../../testing/manual-clock.js";
import {
  openRacingSchedule,
  RACING_EPISODE_MS,
  racingRegenerator,
} from "../../testing/racing-schedule.js";
import { recordingLog } from "../../testing/recording-log.js";
import {
  readOnlyScheduleState,
  readScheduleEntries,
} from "../../testing/schedule-fixtures.js";
import { settleWithin } from "../../testing/settle-within.js";
import { createBarrier } from "../../testing/test-barrier.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";
import { SqliteTransitionCoordinator } from "./sqlite-transition-coordinator.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
// The boundary between the first and second episodes.
const BOUNDARY = FIXTURE_TIME + RACING_EPISODE_MS;
// Comfortably longer than any race below needs, so only a bug exhausts it.
const WAIT_MS = 2_000;
// How long a race side may take before the test names it as hung.
const SETTLE_MS = 1_000;

/**
 * Builds the coordinator on the racing schedule's second connection, so it
 * contends with the writer for write authority as separate processes would.
 */
async function setup() {
  const { writer, other, channelId, scheduleRevision } =
    await openRacingSchedule();
  const clock = manualClock(BOUNDARY);
  const coordinatorWith = (
    transactionHooks?: ImmediateTransactionHooks,
    writeAuthorityWaitMs = WAIT_MS,
  ) =>
    new SqliteTransitionCoordinator(other, clock.now, {
      writeAuthorityWaitMs,
      transactionHooks,
    });
  // The worker's prepared transition into the second entry.
  const candidate: TransitionCandidate = {
    channelId,
    scheduleEntryId: "original-002",
    scheduleRevision,
  };
  return {
    writer,
    other,
    channelId,
    clock,
    coordinator: coordinatorWith(),
    coordinatorWith,
    candidate,
  };
}

describe("SqliteTransitionCoordinator", () => {
  it("commits a candidate that covers the boundary under the current revision", async () => {
    const { coordinator, candidate } = await setup();
    const commit = vi.fn();

    await expect(
      coordinator.commitPreparedTransition(candidate, commit),
    ).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
  });

  it("never commits a candidate before its boundary", async () => {
    const { clock, coordinator, candidate } = await setup();
    clock.set(BOUNDARY - 1);
    const commit = vi.fn();

    await expect(
      coordinator.commitPreparedTransition(candidate, commit),
    ).resolves.toBe("stale");
    expect(commit).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a revision that has since moved on",
      change: (c: TransitionCandidate) => ({
        ...c,
        scheduleRevision: c.scheduleRevision - 1,
      }),
    },
    {
      name: "an entry that does not cover the boundary",
      change: (c: TransitionCandidate) => ({
        ...c,
        scheduleEntryId: "original-003",
      }),
    },
    {
      name: "another channel",
      change: (c: TransitionCandidate) => ({ ...c, channelId: "missing" }),
    },
  ])("reports $name as stale without committing", async ({ change }) => {
    const { coordinator, candidate } = await setup();
    const commit = vi.fn();

    await expect(
      coordinator.commitPreparedTransition(change(candidate), commit),
    ).resolves.toBe("stale");
    expect(commit).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "disabled",
      change: (writer: Kysely<DatabaseSchema>, channelId: string) =>
        writer
          .updateTable("channels")
          .set({ enabled: 0 })
          .where("id", "=", channelId)
          .execute(),
    },
    {
      name: "deleted",
      change: (writer: Kysely<DatabaseSchema>, channelId: string) =>
        writer.deleteFrom("channels").where("id", "=", channelId).execute(),
    },
  ])(
    "reports a channel $name since preparation as stale",
    async ({ change }) => {
      const { writer, channelId, coordinator, candidate } = await setup();
      await change(writer, channelId);
      const commit = vi.fn();

      await expect(
        coordinator.commitPreparedTransition(candidate, commit),
      ).resolves.toBe("stale");
      expect(commit).not.toHaveBeenCalled();
    },
  );

  it("rejects with the callback's failure and releases write authority", async () => {
    const { coordinator, candidate } = await setup();
    const failure = new Error("session commit failed");

    await expect(
      coordinator.commitPreparedTransition(candidate, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expect(
      coordinator.commitPreparedTransition(candidate, vi.fn()),
    ).resolves.toBe("committed");
  });

  it("reads boundary time only once it holds write authority", async () => {
    const { writer, clock, coordinatorWith, candidate } = await setup();
    clock.set(BOUNDARY - 1);
    const holder = await holdWriteAuthority(writer);
    try {
      // The clock reaches the boundary while the coordinator waits for the lock.
      const coordinator = coordinatorWith({
        onBusy: async () => {
          clock.set(BOUNDARY);
          await holder.release();
        },
      });
      const commit = vi.fn();

      await expect(
        coordinator.commitPreparedTransition(candidate, commit),
      ).resolves.toBe("committed");
      expect(commit).toHaveBeenCalledOnce();
    } finally {
      await holder.release();
    }
  });

  describe("waiting for write authority", () => {
    it("keeps waiting through contention that outlasts a schedule mutation's retries", async () => {
      const { writer, coordinator, candidate } = await setup();
      const holder = await holdWriteAuthority(writer);
      try {
        const outcome = coordinator.commitPreparedTransition(
          candidate,
          vi.fn(),
        );
        // Schedule mutations give up after about 150 ms of contention.
        await delay(300);
        await holder.release();

        await expect(outcome).resolves.toBe("committed");
      } finally {
        await holder.release();
      }
    });

    it("gives up once its wait is spent", async () => {
      const { writer, coordinatorWith, candidate } = await setup();
      const holder = await holdWriteAuthority(writer);
      try {
        const commit = vi.fn();

        await expect(
          coordinatorWith(undefined, 100).commitPreparedTransition(
            candidate,
            commit,
          ),
        ).rejects.toBeInstanceOf(WriteAuthorityBusyError);
        expect(commit).not.toHaveBeenCalled();
      } finally {
        await holder.release();
      }
    });

    it.each([0, -1, 1.5, Number.NaN])(
      "rejects a wait of %s, which could never bound the retries",
      async (writeAuthorityWaitMs) => {
        const { other } = await openRacingSchedule();

        expect(
          () =>
            new SqliteTransitionCoordinator(other, () => BOUNDARY, {
              writeAuthorityWaitMs,
            }),
        ).toThrow(RangeError);
      },
    );
  });

  describe("racing a regeneration on another connection", () => {
    it("never commits stale output when regeneration takes write authority first", async () => {
      const { writer, channelId, coordinatorWith, candidate } = await setup();
      const regenerationHeld = createBarrier();
      // Regenerates a minute before the boundary, replacing the prepared entry.
      const regenerating = racingRegenerator(writer, BOUNDARY - MINUTE, {
        afterBegin: () => regenerationHeld.wait(),
      }).regenerate(channelId, recordingLog());
      await settleWithin(
        regenerationHeld.reached,
        SETTLE_MS,
        "regeneration taking write authority",
      );

      const coordinator = coordinatorWith({
        onBusy: () => regenerationHeld.release(),
      });
      const commit = vi.fn();
      const outcome = coordinator.commitPreparedTransition(candidate, commit);

      await expect(
        settleWithin(regenerating, SETTLE_MS, "regeneration"),
      ).resolves.toMatchObject({ kind: "covered" });
      await expect(
        settleWithin(outcome, SETTLE_MS, "transition commit"),
      ).resolves.toBe("stale");
      expect(commit).not.toHaveBeenCalled();
      expect(await coveringEntry(writer, channelId, BOUNDARY)).toMatchObject({
        id: "regenerated-001",
      });
    });

    it("commits once and keeps the new item through its endsAt when the transition takes write authority first", async () => {
      const { writer, channelId, coordinatorWith, candidate } = await setup();
      const transitionHeld = createBarrier();
      const coordinator = coordinatorWith({
        afterBegin: () => transitionHeld.wait(),
      });
      const commit = vi.fn();
      const outcome = coordinator.commitPreparedTransition(candidate, commit);
      await settleWithin(
        transitionHeld.reached,
        SETTLE_MS,
        "transition taking write authority",
      );

      // Regenerates a minute after the boundary, once the transition commits.
      const regenerating = racingRegenerator(writer, BOUNDARY + MINUTE, {
        onBusy: () => transitionHeld.release(),
      }).regenerate(channelId, recordingLog());

      await expect(
        settleWithin(outcome, SETTLE_MS, "transition commit"),
      ).resolves.toBe("committed");
      expect(commit).toHaveBeenCalledOnce();
      await expect(
        settleWithin(regenerating, SETTLE_MS, "regeneration"),
      ).resolves.toMatchObject({ kind: "covered" });
      const { schedule_revision } = await readOnlyScheduleState(writer);
      expect(schedule_revision).toBeGreaterThan(candidate.scheduleRevision);
      expect(
        await coveringEntry(writer, channelId, BOUNDARY + MINUTE),
      ).toMatchObject({
        id: "original-002",
        ends_at: BOUNDARY + RACING_EPISODE_MS,
      });
      expect(
        await coveringEntry(writer, channelId, BOUNDARY + RACING_EPISODE_MS),
      ).toMatchObject({ id: "regenerated-001" });
    });
  });
});

/** Reads the persisted entry airing at `at`, or undefined in a gap. */
async function coveringEntry(
  db: Kysely<DatabaseSchema>,
  channelId: string,
  at: number,
) {
  const entries = await readScheduleEntries(db, channelId);
  return entries.find((entry) => entry.starts_at <= at && at < entry.ends_at);
}
