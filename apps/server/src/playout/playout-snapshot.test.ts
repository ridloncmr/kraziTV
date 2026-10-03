import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { countQueries } from "../testing/query-counter.js";
import {
  insertScheduleEntries,
  insertScheduleState,
  seedScheduleScenario,
} from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";
import { SCHEDULE_REQUEST_LIMIT_MS } from "../schedules/schedule-coverage.js";
import type { CoverageRequirement } from "./contracts.js";
import { findCoveringPlayoutEntries } from "./playout-repository.js";
import { readPlayoutSnapshot } from "./playout-snapshot.js";

afterEach(cleanUpTestEnvironment);

const HOUR = 3_600_000;
const T0 = FIXTURE_TIME;
const HORIZON_FROM_T0 = T0 + SCHEDULE_HORIZON_MS;
const NO_REQUIREMENT: CoverageRequirement = { kind: "none" };

// Seeds the fixture channel with one hour-long item; `state` adds schedule state.
async function setup(
  options: {
    enabled?: boolean;
    state?: { lastGeneratedThrough: number; scheduleRevision: number };
  } = {},
) {
  const { db } = await openTestDatabase();
  const { channelId, itemIds } = await seedScheduleScenario(db, {
    items: [{ durationMs: HOUR }],
    source: "chronological",
    enabled: options.enabled,
  });
  if (options.state !== undefined) {
    await insertScheduleState(db, options.state);
    await insertScheduleEntries(db, [
      {
        mediaItemId: itemIds[0],
        startsAt: T0,
        endsAt: T0 + HOUR,
        sequenceNumber: 0,
      },
    ]);
  }
  return { db, channelId };
}

// A read that reports only the revision it was given.
const readRevision = vi.fn(async (_trx: unknown, revision: number) => revision);

describe("readPlayoutSnapshot", () => {
  afterEach(() => readRevision.mockClear());

  it("reports an unknown channel without reading playout rows", async () => {
    const { db } = await openTestDatabase();

    await expect(
      readPlayoutSnapshot(
        db,
        "channel-missing",
        T0,
        { coverage: NO_REQUIREMENT },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "not_found" });
    expect(readRevision).not.toHaveBeenCalled();
  });

  it("reports a disabled channel even when its coverage falls short", async () => {
    const { db, channelId } = await setup({ enabled: false });

    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0,
        { coverage: { kind: "horizon" } },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "disabled" });
    expect(readRevision).not.toHaveBeenCalled();
  });

  it("reads a channel with no schedule state at revision 0", async () => {
    const { db, channelId } = await setup();

    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0,
        { coverage: NO_REQUIREMENT },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "ok", scheduleRevision: 0, value: 0 });
  });

  it("asks for a full horizon when a channel has no schedule state", async () => {
    const { db, channelId } = await setup();

    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0,
        { coverage: { kind: "horizon" } },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "coverage_needed", target: HORIZON_FROM_T0 });
    expect(readRevision).not.toHaveBeenCalled();
  });

  it("asks for coverage through a later instant than the horizon", async () => {
    const { db, channelId } = await setup({
      state: { lastGeneratedThrough: HORIZON_FROM_T0, scheduleRevision: 4 },
    });
    const through = HORIZON_FROM_T0 + HOUR;

    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0,
        { coverage: { kind: "horizon", through } },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "coverage_needed", target: through });
  });

  it("serves a channel short of its horizon only when coverage is not required", async () => {
    const { db, channelId } = await setup({
      state: { lastGeneratedThrough: T0 + HOUR, scheduleRevision: 4 },
    });

    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0,
        { coverage: { kind: "horizon" } },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "coverage_needed", target: HORIZON_FROM_T0 });
    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0,
        { coverage: NO_REQUIREMENT },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "ok", scheduleRevision: 4, value: 4 });
  });

  it("serves a channel whose coverage reaches its horizon", async () => {
    const { db, channelId } = await setup({
      state: { lastGeneratedThrough: HORIZON_FROM_T0, scheduleRevision: 4 },
    });

    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0,
        { coverage: { kind: "horizon" } },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "ok", scheduleRevision: 4, value: 4 });
  });

  it("checks a supplied target as given instead of recomputing it", async () => {
    const { db, channelId } = await setup({
      state: { lastGeneratedThrough: T0 + HOUR, scheduleRevision: 4 },
    });

    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0,
        { coverage: { kind: "target", target: T0 + HOUR } },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "ok", scheduleRevision: 4, value: 4 });
    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0,
        { coverage: { kind: "target", target: T0 + HOUR + 1 } },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "coverage_needed", target: T0 + HOUR + 1 });
  });

  it("aims the horizon from the last mutation when the clock is behind it", async () => {
    const { db, channelId } = await setup({
      state: { lastGeneratedThrough: T0 + HOUR, scheduleRevision: 4 },
    });

    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0 - HOUR,
        { coverage: { kind: "horizon" } },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "coverage_needed", target: HORIZON_FROM_T0 });
  });

  it("refuses a coverage instant past the request limit", async () => {
    const { db, channelId } = await setup();
    const latestThrough = T0 + SCHEDULE_REQUEST_LIMIT_MS;

    await expect(
      readPlayoutSnapshot(
        db,
        channelId,
        T0,
        { coverage: { kind: "horizon", through: latestThrough + 1 } },
        readRevision,
      ),
    ).resolves.toEqual({ kind: "through_out_of_range", latestThrough });
    expect(readRevision).not.toHaveBeenCalled();
  });

  it("reads playout rows through the snapshot in a fixed number of statements", async () => {
    const { db, channelId } = await setup({
      state: { lastGeneratedThrough: HORIZON_FROM_T0, scheduleRevision: 4 },
    });
    const counter = countQueries(db);
    let statementsAtHook: number | undefined;

    const snapshot = await readPlayoutSnapshot(
      counter.db,
      channelId,
      T0,
      {
        coverage: { kind: "horizon" },
        afterRevisionRead: () => {
          statementsAtHook = counter.count();
        },
      },
      (trx) => findCoveringPlayoutEntries(trx, channelId, T0),
    );

    expect(snapshot).toMatchObject({
      kind: "ok",
      scheduleRevision: 4,
      value: [{ id: "entry-0" }],
    });
    // The hook runs after the revision read and before the channel read.
    expect(statementsAtHook).toBe(1);
    // Revision, channel, and the one playout query.
    expect(counter.count()).toBe(3);
  });
});
