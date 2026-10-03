import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import { manualClock } from "../../testing/manual-clock.js";
import { sequentialIds } from "../../testing/record-sources.js";
import { recordingLog } from "../../testing/recording-log.js";
import {
  readOnlyScheduleState,
  seedScheduleScenario,
  type ScheduleScenarioOptions,
} from "../../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { unwrittenCoverage } from "../../testing/unwritten-coverage.js";
import { PlayoutService } from "../../playout/playout-service.js";
import { ScheduleService } from "../../schedules/schedule-service.js";
import { ChannelRepository } from "../repository/channel-repository.js";
import { SignalPlayoutAdapter } from "./signal-playout-adapter.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
// Eight minutes into the second episode of a schedule anchored at T0.
const MID_SECOND = T0 + 30 * MINUTE;
const EPISODES = [22, 23, 24].map((minutes) => ({
  durationMs: minutes * MINUTE,
}));

// Three chronological episodes behind a real PlayoutService on a manual clock.
async function setup(scenario: Partial<ScheduleScenarioOptions> = {}) {
  const { db } = await openTestDatabase();
  const { channelId, itemIds } = await seedScheduleScenario(db, {
    items: EPISODES,
    source: "chronological",
    ...scenario,
  });
  const clock = manualClock(T0);
  const schedules = new ScheduleService(db, {
    now: clock.now,
    createId: sequentialIds("entry"),
  });
  const log = recordingLog();
  const channels = new ChannelRepository(db);
  const adapter = new SignalPlayoutAdapter(
    new PlayoutService(db, schedules),
    channels,
    log,
  );
  return { db, channelId, itemIds, clock, channels, adapter, log };
}

describe("SignalPlayoutAdapter.getCurrent", () => {
  it("maps the current item and join offset onto the signal port", async () => {
    const { db, channelId, itemIds, adapter } = await setup();

    const result = await adapter.getCurrent(channelId, MID_SECOND);

    const { schedule_revision } = await readOnlyScheduleState(db);
    expect(result).toEqual({
      status: "current",
      channelId,
      scheduleRevision: schedule_revision,
      evaluatedAt: MID_SECOND,
      mediaOffsetMs: 8 * MINUTE,
      item: {
        channelId,
        scheduleEntryId: "entry-002",
        scheduleRevision: schedule_revision,
        mediaItemId: itemIds[1],
        mediaPath: expect.any(String),
        hasAudio: expect.any(Boolean),
        title: expect.any(String),
        startsAt: T0 + 22 * MINUTE,
        endsAt: T0 + 45 * MINUTE,
        durationMs: 23 * MINUTE,
        startOffsetMs: 0,
      },
    });
  });

  it("passes a schedule gap through with its revision", async () => {
    const { channelId, adapter } = await setup({ source: null });

    await expect(adapter.getCurrent(channelId, MID_SECOND)).resolves.toEqual({
      status: "no_current",
      channelId,
      scheduleRevision: 0,
      evaluatedAt: MID_SECOND,
      reason: "schedule_gap",
    });
  });

  it("passes unavailable media through with the covering entry ID", async () => {
    const { db, channelId, adapter } = await setup();
    await adapter.getCurrent(channelId, T0);
    await db
      .updateTable("media_items")
      .set({ status: "missing" })
      .where("id", "=", "item-002")
      .execute();

    await expect(
      adapter.getCurrent(channelId, MID_SECOND),
    ).resolves.toMatchObject({
      status: "no_current",
      reason: "media_unavailable",
      scheduleEntryId: "entry-002",
    });
  });

  it("throws channel_disabled for a channel disabled after authorization", async () => {
    const { channelId, adapter } = await setup({ enabled: false });

    await expect(adapter.getCurrent(channelId, MID_SECOND)).rejects.toThrow(
      expect.objectContaining({ code: "channel_disabled" }),
    );
  });

  it("throws channel_not_found for an unknown channel", async () => {
    const { adapter } = await setup();

    await expect(adapter.getCurrent("missing", MID_SECOND)).rejects.toThrow(
      expect.objectContaining({ code: "channel_not_found" }),
    );
  });

  it("throws playout_unavailable when coverage stays short after its retry", async () => {
    const { db, channelId, clock, channels, log } = await setup();
    const adapter = new SignalPlayoutAdapter(
      new PlayoutService(db, unwrittenCoverage(clock.now)),
      channels,
      log,
    );

    await expect(adapter.getCurrent(channelId, MID_SECOND)).rejects.toThrow(
      expect.objectContaining({ code: "playout_unavailable" }),
    );
  });

  it("logs a gap repair through the bound server logger", async () => {
    const { channelId, clock, adapter, log } = await setup();
    await adapter.getCurrent(channelId, T0);
    // Past the materialized horizon, nothing covers now, so coverage repairs.
    const later = T0 + 3 * SCHEDULE_HORIZON_MS;
    clock.set(later);

    await adapter.getCurrent(channelId, later);

    expect(log.lines).toContainEqual(
      expect.objectContaining({
        level: "warn",
        fields: expect.objectContaining({ channelId }),
      }),
    );
  });
});

describe("SignalPlayoutAdapter.getFollowing", () => {
  it("maps the items selected after the cursor entry", async () => {
    const { channelId, adapter } = await setup();
    await adapter.getCurrent(channelId, T0);

    const result = await adapter.getFollowing(channelId, "entry-001", 2);

    expect(result).toMatchObject({
      status: "selected",
      channelId,
      items: [
        { scheduleEntryId: "entry-002", startsAt: T0 + 22 * MINUTE },
        { scheduleEntryId: "entry-003", startsAt: T0 + 45 * MINUTE },
      ],
    });
    expect(Object.keys(result.items[0] ?? {})).not.toContain("createdAt");
  });

  it("reports a cursor that regeneration deleted as stale", async () => {
    const { channelId, adapter } = await setup();
    await adapter.getCurrent(channelId, T0);

    await expect(
      adapter.getFollowing(channelId, "entry-gone", 1),
    ).resolves.toMatchObject({ status: "stale_entry", items: [] });
  });

  it("throws channel_disabled for a disabled channel", async () => {
    const { channelId, adapter } = await setup({ enabled: false });

    await expect(
      adapter.getFollowing(channelId, "entry-001", 1),
    ).rejects.toThrow(expect.objectContaining({ code: "channel_disabled" }));
  });
});

describe("SignalPlayoutAdapter.getScheduleRevision", () => {
  it("reads the channel's current schedule revision", async () => {
    const { db, channelId, adapter } = await setup();
    await adapter.getCurrent(channelId, T0);

    const { schedule_revision } = await readOnlyScheduleState(db);
    await expect(adapter.getScheduleRevision(channelId)).resolves.toBe(
      schedule_revision,
    );
  });
});

describe("SignalPlayoutAdapter.getChannelAuthorization", () => {
  it("authorizes an enabled channel", async () => {
    const { channelId, adapter } = await setup();

    await expect(adapter.getChannelAuthorization(channelId)).resolves.toEqual({
      status: "enabled",
      channelId,
    });
  });

  it("reports a disabled channel", async () => {
    const { channelId, adapter } = await setup({ enabled: false });

    await expect(adapter.getChannelAuthorization(channelId)).resolves.toEqual({
      status: "disabled",
      channelId,
    });
  });

  it("reports an unknown channel", async () => {
    const { adapter } = await setup();

    await expect(adapter.getChannelAuthorization("missing")).resolves.toEqual({
      status: "not_found",
      channelId: "missing",
    });
  });
});
