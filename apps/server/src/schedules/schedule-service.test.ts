import { deriveChannelSeed, SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import { type Kysely, type Selectable, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ScheduleEntryTable } from "../database/schema/schedule-entry-table.js";
import { WriteAuthorityBusyError } from "../database/writes/immediate-transaction.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import { recordingLog } from "../testing/recording-log.js";
import {
  seedScheduleScenario,
  type ScheduleScenarioOptions,
} from "../testing/schedule-fixtures.js";
import { createBarrier } from "../testing/test-barrier.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
} from "../testing/test-environment.js";
import { ScheduleService } from "./schedule-service.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const EPISODES = [22, 23, 24].map((minutes) => ({
  durationMs: minutes * MINUTE,
}));
const T0 = FIXTURE_TIME;

// Seeds a scenario, defaulting to three chronological episodes, and builds a service on a manual clock.
async function setup(
  scenario: Partial<ScheduleScenarioOptions> = {},
  entriesPerTransaction?: number,
) {
  const { db } = await openTestDatabase();
  const { channelId, collectionId } = await seedScheduleScenario(db, {
    items: EPISODES,
    source: "chronological",
    ...scenario,
  });
  const clock = manualClock(T0);
  const service = new ScheduleService(db, {
    now: clock.now,
    createId: sequentialIds("entry"),
    entriesPerTransaction,
  });
  return { db, channelId, collectionId, clock, service, log: recordingLog() };
}

// Reads a channel's schedule state row, or undefined before the first generation.
function readState(db: Kysely<DatabaseSchema>, channelId: string) {
  return db
    .selectFrom("channel_schedule_states")
    .selectAll()
    .where("channel_id", "=", channelId)
    .executeTakeFirst();
}

// Reads a channel's entries in sequence order.
function readEntries(db: Kysely<DatabaseSchema>, channelId: string) {
  return db
    .selectFrom("schedule_entries")
    .selectAll()
    .where("channel_id", "=", channelId)
    .orderBy("sequence_number")
    .execute();
}

// Reads every progress row, so tests also see rows that should not exist.
function readProgress(db: Kysely<DatabaseSchema>) {
  return db.selectFrom("channel_collection_progress").selectAll().execute();
}

/** Asserts the transactional invariants: unique, increasing sequence numbers and contiguous, non-overlapping times. */
function expectContiguous(entries: Selectable<ScheduleEntryTable>[]): void {
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    if (previous === undefined) return;
    expect(entry.sequence_number).toBeGreaterThan(previous.sequence_number);
    expect(entry.starts_at).toBe(previous.ends_at);
  });
}

describe("ScheduleService.ensureCoverage", () => {
  it("creates state at revision 1 and covers the horizon from the anchor", async () => {
    const { db, channelId, collectionId, service, log } = await setup();

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual({ kind: "covered", scheduleRevision: 1 });
    const entries = await readEntries(db, channelId);
    const last = entries.at(-1)!;
    expect(entries[0]).toMatchObject({
      starts_at: T0,
      sequence_number: 0,
      title: "Item 1",
      playback_mode: "chronological",
      playback_index: 0,
    });
    expect(last.ends_at).toBeGreaterThanOrEqual(T0 + SCHEDULE_HORIZON_MS);
    expect(last.starts_at).toBeLessThan(T0 + SCHEDULE_HORIZON_MS);
    expectContiguous(entries);
    await expect(readState(db, channelId)).resolves.toEqual({
      channel_id: channelId,
      seed: deriveChannelSeed(channelId, T0),
      anchor_time: T0,
      last_generated_through: last.ends_at,
      next_sequence_number: entries.length,
      schedule_revision: 1,
      created_at: T0,
      updated_at: T0,
    });
    await expect(readProgress(db)).resolves.toEqual([
      {
        channel_id: channelId,
        media_collection_id: collectionId,
        next_chronological_position: (last.playback_index! + 1) % 3,
        next_random_selection_index: 0,
        updated_at: T0,
      },
    ]);
    expect(log.lines).toEqual([]);
  });

  it("stores random progress as the index after the last entry", async () => {
    const { db, channelId, service, log } = await setup({ source: "random" });

    await service.ensureCoverage(channelId, log);

    const entries = await readEntries(db, channelId);
    expect(entries.map((entry) => entry.playback_index)).toEqual(
      entries.map((_, index) => index),
    );
    const [progress] = await readProgress(db);
    expect(progress).toMatchObject({
      next_chronological_position: 0,
      next_random_selection_index: entries.length,
    });
  });

  it("repeats a single item without collection progress", async () => {
    const { db, channelId, service, log } = await setup({
      source: "media_item",
    });

    await service.ensureCoverage(channelId, log);

    const entries = await readEntries(db, channelId);
    expect(new Set(entries.map((entry) => entry.media_item_id))).toEqual(
      new Set(["item-001"]),
    );
    expect(entries[0]).toMatchObject({
      media_collection_id: null,
      playback_mode: null,
      playback_index: null,
    });
    await expect(readProgress(db)).resolves.toEqual([]);
  });

  it("covers through a requested instant beyond the horizon", async () => {
    const { db, channelId, service, log } = await setup();
    const through = T0 + SCHEDULE_HORIZON_MS + 24 * HOUR;

    await service.ensureCoverage(channelId, log, through);

    const state = await readState(db, channelId);
    expect(state?.last_generated_through).toBeGreaterThanOrEqual(through);
  });

  it.each([
    ["before now", T0 - HOUR],
    ["at now", T0],
    ["inside the horizon", T0 + HOUR],
  ])(
    "still covers the full horizon when the requested instant is %s",
    async (_, through) => {
      const { db, channelId, clock, service, log } = await setup();

      await expect(
        service.ensureCoverage(channelId, log, through),
      ).resolves.toEqual({ kind: "covered", scheduleRevision: 1 });

      const state = await readState(db, channelId);
      expect(state?.last_generated_through).toBeGreaterThanOrEqual(
        T0 + SCHEDULE_HORIZON_MS,
      );
      clock.advance(MINUTE);
      await expect(service.ensureCoverage(channelId, log)).resolves.toEqual({
        kind: "covered",
        scheduleRevision: 1,
      });
    },
  );

  it.each([0, -1, 1.5])(
    "rejects a chunk size of %s, which could never make progress",
    async (entriesPerTransaction) => {
      const { db } = await openTestDatabase();

      expect(() => new ScheduleService(db, { entriesPerTransaction })).toThrow(
        RangeError,
      );
    },
  );

  it("writes nothing when coverage already reaches the target", async () => {
    const { db, channelId, clock, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const entries = await readEntries(db, channelId);
    const state = await readState(db, channelId);
    clock.advance(MINUTE);

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual({ kind: "covered", scheduleRevision: 1 });
    await expect(readEntries(db, channelId)).resolves.toEqual(entries);
    await expect(readState(db, channelId)).resolves.toEqual(state);
  });

  it("extends coverage as time advances without changing existing entries", async () => {
    const { db, channelId, clock, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const before = await readEntries(db, channelId);
    clock.advance(6 * HOUR);

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual({ kind: "covered", scheduleRevision: 2 });
    const after = await readEntries(db, channelId);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBeGreaterThan(before.length);
    expectContiguous(after);
    const state = await readState(db, channelId);
    expect(state).toMatchObject({
      anchor_time: T0,
      next_sequence_number: after.length,
      last_generated_through: after.at(-1)!.ends_at,
      updated_at: T0 + 6 * HOUR,
    });
    expect(state!.last_generated_through).toBeGreaterThanOrEqual(
      T0 + 6 * HOUR + SCHEDULE_HORIZON_MS,
    );
    expect(after[before.length]).toMatchObject({
      created_at: T0 + 6 * HOUR,
      playback_index: (before.at(-1)!.playback_index! + 1) % 3,
    });
  });

  it("extends in bounded chunks, one revision per chunk", async () => {
    // Ten-hour items need eight entries to cover 72 hours: chunks of 3, 3, and 2.
    const { db, channelId, service, log } = await setup(
      { items: [{ durationMs: 10 * HOUR }] },
      3,
    );

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual({ kind: "covered", scheduleRevision: 3 });
    const entries = await readEntries(db, channelId);
    expect(entries).toHaveLength(8);
    expectContiguous(entries);
    expect(entries.map((entry) => entry.id)).toEqual(
      entries.map((_, index) => `entry-${String(index + 1).padStart(3, "0")}`),
    );
  });

  it("rolls back entries, progress, and state together when a write fails", async () => {
    const { db, channelId, service, log } = await setup();
    // Fails the state write, which follows the entry and progress writes.
    await sql`
      create trigger fail_state_write before insert on channel_schedule_states
      begin select raise(abort, 'injected failure'); end
    `.execute(db);

    await expect(service.ensureCoverage(channelId, log)).rejects.toThrow(
      /injected failure/,
    );

    await expect(readEntries(db, channelId)).resolves.toEqual([]);
    await expect(readProgress(db)).resolves.toEqual([]);
    await expect(readState(db, channelId)).resolves.toBeUndefined();
  });

  it("serializes concurrent ensures on one connection", async () => {
    const { db, channelId, service, log } = await setup();

    const results = await Promise.all([
      service.ensureCoverage(channelId, log),
      service.ensureCoverage(channelId, log),
    ]);

    expect(results).toEqual([
      { kind: "covered", scheduleRevision: 1 },
      { kind: "covered", scheduleRevision: 1 },
    ]);
    const state = await readState(db, channelId);
    expect(state?.next_sequence_number).toBe(
      (await readEntries(db, channelId)).length,
    );
  });

  it("keeps entries unique and non-overlapping when two connections race", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const a = (await openTestDatabase(dataDirectory)).db;
    const b = (await openTestDatabase(dataDirectory)).db;
    const { channelId } = await seedScheduleScenario(a, {
      items: EPISODES,
      source: "chronological",
    });
    const barrier = createBarrier();
    const serviceA = new ScheduleService(a, {
      now: () => T0,
      createId: sequentialIds("a"),
      transactionHooks: { afterBegin: () => barrier.wait() },
    });
    // B releases A on its first busy attempt, so A commits while B retries.
    const serviceB = new ScheduleService(b, {
      now: () => T0,
      createId: sequentialIds("b"),
      transactionHooks: { onBusy: () => barrier.release() },
    });

    const first = serviceA.ensureCoverage(channelId, recordingLog());
    await barrier.reached;
    const second = await serviceB
      .ensureCoverage(channelId, recordingLog())
      .catch((error: unknown) => error);
    barrier.release();

    await expect(first).resolves.toEqual({
      kind: "covered",
      scheduleRevision: 1,
    });
    if (second instanceof WriteAuthorityBusyError) {
      expect(second.retryable).toBe(true);
    } else {
      expect(second).toEqual({ kind: "covered", scheduleRevision: 1 });
    }
    const entries = await readEntries(a, channelId);
    expect(entries.every((entry) => entry.id.startsWith("a-"))).toBe(true);
    expectContiguous(entries);
  });

  it("never moves generation earlier when the clock steps backward", async () => {
    const { db, channelId, clock, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    clock.set(T0 + 2 * HOUR);
    await service.ensureCoverage(channelId, log);
    const before = await readEntries(db, channelId);
    clock.set(T0 + HOUR);

    // Requests more coverage, so the stepped-back call must write.
    const result = await service.ensureCoverage(
      channelId,
      log,
      T0 + 2 * HOUR + SCHEDULE_HORIZON_MS + 24 * HOUR,
    );

    expect(result).toEqual({ kind: "covered", scheduleRevision: 3 });
    const after = await readEntries(db, channelId);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[before.length]?.created_at).toBe(T0 + 2 * HOUR);
    await expect(readState(db, channelId)).resolves.toMatchObject({
      updated_at: T0 + 2 * HOUR,
    });
    expect(log.lines).toEqual([
      {
        level: "warn",
        fields: { channelId, now: T0 + HOUR, effectiveNow: T0 + 2 * HOUR },
        message: expect.stringMatching(/clock/i),
      },
    ]);
  });

  it("reports a gap without writing once coverage falls behind now", async () => {
    const { db, channelId, clock, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const state = await readState(db, channelId);
    clock.advance(SCHEDULE_HORIZON_MS + 24 * HOUR);

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual({ kind: "schedule_gap" });
    await expect(readState(db, channelId)).resolves.toEqual(state);
  });

  it("reports a missing channel", async () => {
    const { service, log } = await setup();

    await expect(service.ensureCoverage("missing", log)).resolves.toEqual({
      kind: "channel_not_found",
    });
  });

  it.each([
    ["a disabled channel", { enabled: false }, { kind: "disabled" }],
    [
      "a channel without a block",
      { source: null },
      { kind: "unschedulable", reason: "no_programming_block" },
    ],
    [
      "a collection with no schedulable members",
      {
        items: [
          { durationMs: HOUR, status: "missing" as const },
          { durationMs: 500 },
        ],
      },
      { kind: "unschedulable", reason: "no_schedulable_media" },
    ],
    [
      "an empty collection",
      { items: [] },
      { kind: "unschedulable", reason: "no_schedulable_media" },
    ],
    [
      "an unschedulable single item",
      { source: "media_item" as const, items: [{ durationMs: 500 }] },
      { kind: "unschedulable", reason: "no_schedulable_media" },
    ],
  ])("writes nothing for %s", async (_, scenario, expected) => {
    const { db, channelId, service, log } = await setup(scenario);

    await expect(service.ensureCoverage(channelId, log)).resolves.toEqual(
      expected,
    );

    await expect(readState(db, channelId)).resolves.toBeUndefined();
    await expect(readEntries(db, channelId)).resolves.toEqual([]);
    await expect(readProgress(db)).resolves.toEqual([]);
  });
});
