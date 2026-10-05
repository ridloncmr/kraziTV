import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import { recordingLog } from "../testing/recording-log.js";
import { unwrittenCoverage } from "../testing/unwritten-coverage.js";
import {
  readOnlyScheduleState,
  readScheduleEntries,
  seedScheduleScenario,
  type ScheduleScenarioOptions,
} from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";
import { SCHEDULE_REQUEST_LIMIT_MS } from "../schedules/schedule-coverage.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import type { PlayoutTimeline } from "./contracts.js";
import { PlayoutService } from "./playout-service.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = FIXTURE_TIME;
// Eight minutes into the second episode of a schedule anchored at T0.
const MID_SECOND = T0 + 30 * MINUTE;
const EPISODES = [22, 23, 24].map((minutes) => ({
  durationMs: minutes * MINUTE,
}));

// Three chronological episodes on a manual clock, with the service under test
// sharing the schedule service's clock.
async function setup(scenario: Partial<ScheduleScenarioOptions> = {}) {
  const { db } = await openTestDatabase();
  const { channelId } = await seedScheduleScenario(db, {
    items: EPISODES,
    source: "chronological",
    ...scenario,
  });
  const clock = manualClock(T0);
  const schedules = new ScheduleService(db, {
    now: clock.now,
    createId: sequentialIds("entry"),
  });
  const playout = new PlayoutService(db, schedules);
  return { db, channelId, clock, schedules, playout, log: recordingLog() };
}

describe("PlayoutService.getCurrent", () => {
  it("ensures coverage for a channel short of its horizon, then answers from the new schedule", async () => {
    const { db, channelId, playout, log } = await setup();

    const state = await playout.getCurrent(channelId, MID_SECOND, log);

    const { schedule_revision } = await readOnlyScheduleState(db);
    expect(state).toMatchObject({
      kind: "current",
      channelId,
      scheduleRevision: schedule_revision,
      evaluatedAt: MID_SECOND,
      currentItem: {
        scheduleEntryId: "entry-002",
        startsAt: T0 + 22 * MINUTE,
        offsetMs: 8 * MINUTE,
      },
      nextItem: { scheduleEntryId: "entry-003", startsAt: T0 + 45 * MINUTE },
    });
  });

  it("evaluates at the clock's time when no instant is given", async () => {
    const { channelId, clock, playout, log } = await setup();
    await playout.getCurrent(channelId, undefined, log);
    clock.set(MID_SECOND);

    const state = await playout.getCurrent(channelId, undefined, log);

    expect(state).toMatchObject({
      evaluatedAt: MID_SECOND,
      currentItem: { scheduleEntryId: "entry-002", offsetMs: 8 * MINUTE },
    });
  });

  it("answers a covered channel without ensuring coverage again", async () => {
    const { channelId, clock, schedules, playout, log } = await setup();
    const first = await playout.getCurrent(channelId, MID_SECOND, log);
    const ensureCoverage = vi.spyOn(schedules, "ensureCoverage");
    clock.advance(MINUTE);

    const second = await playout.getCurrent(channelId, MID_SECOND, log);

    expect(ensureCoverage).not.toHaveBeenCalled();
    expect(second).toEqual(first);
  });

  it("reports unavailable when coverage is still short after its one retry", async () => {
    const { db, channelId, clock } = await setup();
    const coverage = unwrittenCoverage(clock.now);
    const playout = new PlayoutService(db, coverage);

    await expect(
      playout.getCurrent(channelId, MID_SECOND, recordingLog()),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(coverage.calls).toBe(1);
  });

  it("retries against the first snapshot's target even when the clock moves during the write", async () => {
    const { db, channelId, clock, schedules } = await setup();
    // The clock passes an hour while coverage is written, so a recomputed
    // horizon would reach past what the write produced.
    const playout = new PlayoutService(db, {
      ensureCoverage: async (...args) => {
        const result = await schedules.ensureCoverage(...args);
        clock.advance(HOUR);
        return result;
      },
      now: clock.now,
    });

    await expect(
      playout.getCurrent(channelId, MID_SECOND, recordingLog()),
    ).resolves.toMatchObject({ kind: "current" });
  });

  it("reports a schedule gap at revision 0 for an unschedulable channel with no entries", async () => {
    const { channelId, playout, log } = await setup({ source: null });

    await expect(
      playout.getCurrent(channelId, MID_SECOND, log),
    ).resolves.toEqual({
      kind: "no_current",
      channelId,
      scheduleRevision: 0,
      evaluatedAt: MID_SECOND,
      currentItem: null,
      nextItem: null,
      reason: "schedule_gap",
    });
  });

  it("still serves the airing entry once the channel becomes unschedulable", async () => {
    const { db, channelId, clock, playout, log } = await setup();
    await playout.getCurrent(channelId, T0, log);
    await db.deleteFrom("programming_blocks").execute();
    // A minute later the horizon is short again, and ensuring it now fails.
    clock.set(T0 + MINUTE);

    const state = await playout.getCurrent(channelId, undefined, log);

    expect(state).toMatchObject({
      kind: "current",
      currentItem: { scheduleEntryId: "entry-001", offsetMs: MINUTE },
    });
  });

  it("reports unavailable media without touching the schedule", async () => {
    const { db, channelId, playout, log } = await setup();
    await playout.getCurrent(channelId, T0, log);
    await db
      .updateTable("media_items")
      .set({ status: "missing" })
      .where("id", "=", "item-002")
      .execute();
    const before = await readScheduleEntries(db, channelId);

    const state = await playout.getCurrent(channelId, MID_SECOND, log);

    expect(state).toMatchObject({
      kind: "no_current",
      reason: "media_unavailable",
      scheduleEntryId: "entry-002",
    });
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual(before);
  });

  it("reports a disabled channel without generating", async () => {
    const { db, channelId, playout, log } = await setup({ enabled: false });

    await expect(
      playout.getCurrent(channelId, MID_SECOND, log),
    ).resolves.toEqual({ kind: "disabled" });
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual([]);
  });

  it("reports an unknown channel", async () => {
    const { playout, log } = await setup();

    await expect(
      playout.getCurrent("channel-missing", MID_SECOND, log),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("rejects an instant past the request limit without generating", async () => {
    const { db, channelId, playout, log } = await setup();

    await expect(
      playout.getCurrent(channelId, T0 + SCHEDULE_REQUEST_LIMIT_MS + 1, log),
    ).resolves.toEqual({
      kind: "through_out_of_range",
      latestThrough: T0 + SCHEDULE_REQUEST_LIMIT_MS,
    });
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual([]);
  });

  it("ensures coverage through a future instant beyond the horizon", async () => {
    const { channelId, playout, log } = await setup();
    const later = T0 + SCHEDULE_HORIZON_MS + 2 * HOUR;

    const state = await playout.getCurrent(channelId, later, log);

    expect(state).toMatchObject({ kind: "current", evaluatedAt: later });
  });
});

describe("PlayoutService.getFollowing", () => {
  it("selects the contiguous items after a cursor entry", async () => {
    const { channelId, playout, log } = await setup();
    await playout.getCurrent(channelId, T0, log);

    const following = await playout.getFollowing(
      channelId,
      "entry-001",
      2,
      log,
    );

    expect(following).toMatchObject({
      status: "selected",
      items: [
        { scheduleEntryId: "entry-002", startsAt: T0 + 22 * MINUTE },
        { scheduleEntryId: "entry-003", startsAt: T0 + 45 * MINUTE },
      ],
    });
  });

  it("reports a cursor entry that no longer exists as stale", async () => {
    const { channelId, playout, log } = await setup();

    await expect(
      playout.getFollowing(channelId, "entry-gone", 2, log),
    ).resolves.toMatchObject({ status: "stale_entry", items: [] });
  });

  it("ensures coverage before selecting", async () => {
    const { db, channelId, playout, log } = await setup();

    const following = await playout.getFollowing(
      channelId,
      "entry-001",
      1,
      log,
    );

    const { schedule_revision } = await readOnlyScheduleState(db);
    expect(following).toMatchObject({
      status: "selected",
      scheduleRevision: schedule_revision,
      items: [{ scheduleEntryId: "entry-002" }],
    });
  });

  it.each([0, -1, 1.5])(
    "rejects a count of %s before ensuring coverage",
    async (count) => {
      const { db, channelId, playout, log } = await setup();

      await expect(
        playout.getFollowing(channelId, "entry-001", count, log),
      ).rejects.toThrow("following count must be a positive integer");
      await expect(readScheduleEntries(db, channelId)).resolves.toEqual([]);
    },
  );

  it("reports a disabled channel", async () => {
    const { channelId, playout, log } = await setup({ enabled: false });

    await expect(
      playout.getFollowing(channelId, "entry-001", 1, log),
    ).resolves.toEqual({ kind: "disabled" });
  });
});

describe("PlayoutService.getTimeline", () => {
  it("ensures coverage, then returns the playable items overlapping the window in order", async () => {
    const { db, channelId, playout, log } = await setup();

    const timeline = await playout.getTimeline(
      channelId,
      T0 + 10 * MINUTE,
      T0 + 50 * MINUTE,
      log,
    );

    const { schedule_revision } = await readOnlyScheduleState(db);
    expect(timeline).toMatchObject({
      kind: "timeline",
      channelId,
      scheduleRevision: schedule_revision,
      items: [
        { scheduleEntryId: "entry-001", startsAt: T0 },
        { scheduleEntryId: "entry-002", startsAt: T0 + 22 * MINUTE },
        { scheduleEntryId: "entry-003", startsAt: T0 + 45 * MINUTE },
      ],
    });
  });

  it("excludes an entry that only touches a window edge", async () => {
    const { channelId, playout, log } = await setup();

    const timeline = await playout.getTimeline(
      channelId,
      T0 + 22 * MINUTE,
      T0 + 45 * MINUTE,
      log,
    );

    expect(timeline).toMatchObject({
      items: [{ scheduleEntryId: "entry-002" }],
    });
  });

  it("omits an entry whose media is not playable", async () => {
    const { db, channelId, playout, log } = await setup();
    await playout.getCurrent(channelId, T0, log);
    await db
      .updateTable("media_items")
      .set({ status: "missing" })
      .where("id", "=", "item-002")
      .execute();

    const timeline = await playout.getTimeline(
      channelId,
      T0,
      T0 + 69 * MINUTE,
      log,
    );

    expect(timeline).toMatchObject({
      items: [
        { scheduleEntryId: "entry-001" },
        { scheduleEntryId: "entry-003" },
      ],
    });
  });

  it("ensures coverage through a window end beyond the horizon", async () => {
    const { channelId, playout, log } = await setup();
    const start = T0 + SCHEDULE_HORIZON_MS + HOUR;

    const timeline = await playout.getTimeline(
      channelId,
      start,
      start + HOUR,
      log,
    );

    // Without coverage through the end, the window would have no items at all.
    expect(timeline).toMatchObject({ kind: "timeline" });
    expect(
      (timeline as PlayoutTimeline).items.at(-1)?.endsAt,
    ).toBeGreaterThanOrEqual(start + HOUR);
  });

  it("rejects a window end past the request limit without generating", async () => {
    const { db, channelId, playout, log } = await setup();
    const end = T0 + SCHEDULE_REQUEST_LIMIT_MS + 1;

    await expect(
      playout.getTimeline(channelId, end - HOUR, end, log),
    ).resolves.toEqual({
      kind: "through_out_of_range",
      latestThrough: T0 + SCHEDULE_REQUEST_LIMIT_MS,
    });
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual([]);
  });

  it("returns no items at revision 0 for an unschedulable channel with no entries", async () => {
    const { channelId, playout, log } = await setup({ source: null });

    await expect(
      playout.getTimeline(channelId, T0, T0 + HOUR, log),
    ).resolves.toEqual({
      kind: "timeline",
      channelId,
      scheduleRevision: 0,
      items: [],
    });
  });

  it("reports unavailable when coverage is still short after its one retry", async () => {
    const { db, channelId, clock } = await setup();
    const coverage = unwrittenCoverage(clock.now);
    const playout = new PlayoutService(db, coverage);

    await expect(
      playout.getTimeline(channelId, T0, T0 + HOUR, recordingLog()),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(coverage.calls).toBe(1);
  });

  it("reports a disabled channel without generating", async () => {
    const { db, channelId, playout, log } = await setup({ enabled: false });

    await expect(
      playout.getTimeline(channelId, T0, T0 + HOUR, log),
    ).resolves.toEqual({ kind: "disabled" });
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual([]);
  });

  it("reports an unknown channel", async () => {
    const { playout, log } = await setup();

    await expect(
      playout.getTimeline("channel-missing", T0, T0 + HOUR, log),
    ).resolves.toEqual({ kind: "not_found" });
  });
});
