import { deriveChannelSeed, SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import { type Kysely, type Selectable, sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ScheduleEntryTable } from "../database/schema/schedule-entry-table.js";
import { WriteAuthorityBusyError } from "../database/writes/immediate-transaction.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import { countQueries } from "../testing/query-counter.js";
import { sequentialIds } from "../testing/record-sources.js";
import { recordingLog } from "../testing/recording-log.js";
import {
  seedScheduleScenario,
  readScheduleEntries,
  type ScheduleScenarioOptions,
} from "../testing/schedule-fixtures.js";
import { createBarrier } from "../testing/test-barrier.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
} from "../testing/test-environment.js";
import { MediaCollectionRepository } from "../media-collections/media-collection-repository.js";
import { membershipChange } from "../media-collections/replace-collection-members.js";
import type { ProgrammingBlockSource } from "../programming-blocks/contracts.js";
import {
  channelFixture,
  programmingBlockFixture,
} from "../testing/channel-fixtures.js";
import { blockChange } from "../programming-blocks/block-change.js";
import { ProgrammingBlockRepository } from "../programming-blocks/programming-block-repository.js";
import { SCHEDULE_REQUEST_LIMIT_MS } from "./schedule-coverage.js";
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

// Reads every progress row, so tests also see rows that should not exist.
function readProgress(db: Kysely<DatabaseSchema>) {
  return db.selectFrom("channel_collection_progress").selectAll().execute();
}

// A covered result at a revision; tests that care about the exact end read the state row.
function covered(scheduleRevision: number) {
  return {
    kind: "covered",
    scheduleRevision,
    generatedThrough: expect.any(Number) as number,
  };
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

    expect(result).toEqual(covered(1));
    const entries = await readScheduleEntries(db, channelId);
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

    const entries = await readScheduleEntries(db, channelId);
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

    const entries = await readScheduleEntries(db, channelId);
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
      ).resolves.toEqual(covered(1));

      const state = await readState(db, channelId);
      expect(state?.last_generated_through).toBeGreaterThanOrEqual(
        T0 + SCHEDULE_HORIZON_MS,
      );
      clock.advance(MINUTE);
      await expect(service.ensureCoverage(channelId, log)).resolves.toEqual(
        covered(1),
      );
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
    const entries = await readScheduleEntries(db, channelId);
    const state = await readState(db, channelId);
    clock.advance(MINUTE);

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual(covered(1));
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual(entries);
    await expect(readState(db, channelId)).resolves.toEqual(state);
  });

  it("extends coverage as time advances without changing existing entries", async () => {
    const { db, channelId, clock, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const before = await readScheduleEntries(db, channelId);
    clock.advance(6 * HOUR);

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual(covered(2));
    const after = await readScheduleEntries(db, channelId);
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

    expect(result).toEqual(covered(3));
    const entries = await readScheduleEntries(db, channelId);
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

    await expect(readScheduleEntries(db, channelId)).resolves.toEqual([]);
    await expect(readProgress(db)).resolves.toEqual([]);
    await expect(readState(db, channelId)).resolves.toBeUndefined();
  });

  it("serializes concurrent ensures on one connection", async () => {
    const { db, channelId, service, log } = await setup();

    const results = await Promise.all([
      service.ensureCoverage(channelId, log),
      service.ensureCoverage(channelId, log),
    ]);

    expect(results).toEqual([covered(1), covered(1)]);
    const state = await readState(db, channelId);
    expect(state?.next_sequence_number).toBe(
      (await readScheduleEntries(db, channelId)).length,
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

    await expect(first).resolves.toEqual(covered(1));
    if (second instanceof WriteAuthorityBusyError) {
      expect(second.retryable).toBe(true);
    } else {
      expect(second).toEqual(covered(1));
    }
    const entries = await readScheduleEntries(a, channelId);
    expect(entries.every((entry) => entry.id.startsWith("a-"))).toBe(true);
    expectContiguous(entries);
  });

  it("never moves generation earlier when the clock steps backward", async () => {
    const { db, channelId, clock, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    clock.set(T0 + 2 * HOUR);
    await service.ensureCoverage(channelId, log);
    const before = await readScheduleEntries(db, channelId);
    clock.set(T0 + HOUR);

    // Requests more coverage, so the stepped-back call must write.
    const result = await service.ensureCoverage(
      channelId,
      log,
      T0 + 2 * HOUR + SCHEDULE_HORIZON_MS + 24 * HOUR,
    );

    expect(result).toEqual(covered(3));
    const after = await readScheduleEntries(db, channelId);
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

  it("reports where coverage ends, whether or not it wrote", async () => {
    const { db, channelId, clock, service, log } = await setup();

    const first = await service.ensureCoverage(channelId, log);
    clock.advance(MINUTE);
    const second = await service.ensureCoverage(channelId, log);

    const state = await readState(db, channelId);
    expect(first).toEqual({
      kind: "covered",
      scheduleRevision: 1,
      generatedThrough: state?.last_generated_through,
    });
    expect(second).toEqual(first);
  });

  it("rejects a requested instant beyond the request limit without writing", async () => {
    const { db, channelId, service, log } = await setup();

    await expect(
      service.ensureCoverage(
        channelId,
        log,
        T0 + SCHEDULE_REQUEST_LIMIT_MS + 1,
      ),
    ).resolves.toEqual({
      kind: "through_out_of_range",
      latestThrough: T0 + SCHEDULE_REQUEST_LIMIT_MS,
    });
    await expect(readState(db, channelId)).resolves.toBeUndefined();

    await expect(
      service.ensureCoverage(channelId, log, T0 + SCHEDULE_REQUEST_LIMIT_MS),
    ).resolves.toEqual(covered(1));
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
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual([]);
    await expect(readProgress(db)).resolves.toEqual([]);
  });
});

describe("ScheduleService gap repair", () => {
  // Hour-long items cover a fresh horizon with exactly 72 entries, and random
  // progress advances by one per entry, so counts compare directly.
  const HOURLY_RANDOM = {
    items: [{ durationMs: HOUR }, { durationMs: HOUR }, { durationMs: HOUR }],
    source: "random" as const,
  };
  const FRESH_HORIZON_ENTRIES = SCHEDULE_HORIZON_MS / HOUR;
  const WEEK = 7 * 24 * HOUR;

  // Covers the horizon at T0 on a statement-counting database.
  async function coveredSetup(scenario: Partial<ScheduleScenarioOptions>) {
    const context = await setup(scenario);
    const counter = countQueries(context.db);
    const service = new ScheduleService(counter.db, {
      now: context.clock.now,
      createId: sequentialIds("entry"),
    });
    await service.ensureCoverage(context.channelId, context.log);
    const before = await readScheduleEntries(context.db, context.channelId);
    const stateBefore = (await readState(context.db, context.channelId))!;
    return { ...context, service, counter, before, stateBefore };
  }

  it("resumes a six-week lapse at the effective current time with a fresh horizon's work", async () => {
    const { db, channelId, clock, service, log, before, stateBefore } =
      await coveredSetup(HOURLY_RANDOM);
    const coveredUntil = stateBefore.last_generated_through;
    const later = T0 + 6 * WEEK + 30 * MINUTE;
    clock.set(later);

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual(covered(2));
    const after = await readScheduleEntries(db, channelId);
    const repaired = after.slice(before.length);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(repaired[0]).toMatchObject({
      starts_at: later,
      sequence_number: stateBefore.next_sequence_number,
    });
    expect(
      after.filter(
        (entry) => entry.starts_at >= coveredUntil && entry.starts_at < later,
      ),
    ).toEqual([]);
    expect(repaired).toHaveLength(FRESH_HORIZON_ENTRIES);
    expectContiguous(repaired);
    await expect(readProgress(db)).resolves.toMatchObject([
      { next_random_selection_index: 2 * FRESH_HORIZON_ENTRIES },
    ]);
    await expect(readState(db, channelId)).resolves.toMatchObject({
      anchor_time: T0,
      seed: stateBefore.seed,
      schedule_revision: 2,
      last_generated_through: later + SCHEDULE_HORIZON_MS,
      updated_at: later,
    });
    expect(log.lines).toEqual([
      {
        level: "warn",
        fields: {
          channelId,
          uncoveredFrom: coveredUntil,
          uncoveredUntil: later,
          deletedEntryCount: 0,
        },
        message: expect.stringMatching(/gap/i),
      },
    ]);
  });

  it("runs the same number of statements however long the lapse", async () => {
    // Measures one repair after a lapse of the given length.
    async function repairStatements(lapseMs: number) {
      const { channelId, clock, service, log, counter } =
        await coveredSetup(HOURLY_RANDOM);
      clock.set(T0 + SCHEDULE_HORIZON_MS + lapseMs);
      const start = counter.count();
      await service.ensureCoverage(channelId, log);
      return counter.count() - start;
    }

    const short = await repairStatements(4 * 24 * HOUR);
    const long = await repairStatements(6 * WEEK);

    expect(long).toBe(short);
  });

  it("repairs coverage that ends exactly at the effective current time", async () => {
    const { db, channelId, clock, service, log, stateBefore } =
      await coveredSetup(HOURLY_RANDOM);
    clock.set(stateBefore.last_generated_through);

    await expect(service.ensureCoverage(channelId, log)).resolves.toEqual(
      covered(2),
    );

    await expect(readState(db, channelId)).resolves.toMatchObject({
      last_generated_through:
        stateBefore.last_generated_through + SCHEDULE_HORIZON_MS,
    });
  });

  it("writes nothing for a lapsed channel that cannot be scheduled, then reports the true gap", async () => {
    const { db, channelId, clock, service, log, stateBefore } =
      await coveredSetup(HOURLY_RANDOM);
    const blocks = await db
      .selectFrom("programming_blocks")
      .selectAll()
      .execute();
    await db.deleteFrom("programming_blocks").execute();
    clock.set(T0 + 2 * WEEK);

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual({
      kind: "unschedulable",
      reason: "no_programming_block",
    });
    await expect(readState(db, channelId)).resolves.toEqual(stateBefore);

    await db.insertInto("programming_blocks").values(blocks).execute();
    clock.set(T0 + 3 * WEEK);
    await service.ensureCoverage(channelId, log);

    expect(log.lines).toEqual([
      expect.objectContaining({
        level: "warn",
        fields: expect.objectContaining({
          uncoveredFrom: stateBefore.last_generated_through,
          uncoveredUntil: T0 + 3 * WEEK,
        }) as unknown,
      }),
    ]);
  });

  it("extends a channel whose coverage has not lapsed without repairing it", async () => {
    const { channelId, clock, service, log } =
      await coveredSetup(HOURLY_RANDOM);
    clock.advance(SCHEDULE_HORIZON_MS - HOUR);

    await expect(service.ensureCoverage(channelId, log)).resolves.toEqual(
      covered(2),
    );

    expect(log.lines).toEqual([]);
  });

  it("keeps a disabled channel's block, state, progress, and entries and stops extending", async () => {
    const { db, channelId, clock, service, log, before, stateBefore } =
      await coveredSetup(HOURLY_RANDOM);
    const progress = await readProgress(db);
    await db.updateTable("channels").set({ enabled: 0 }).execute();
    clock.advance(SCHEDULE_HORIZON_MS - HOUR);

    const extending = await service.ensureCoverage(channelId, log);
    clock.set(T0 + 6 * WEEK);
    const lapsed = await service.ensureCoverage(channelId, log);

    expect(extending).toEqual({ kind: "disabled" });
    expect(lapsed).toEqual({ kind: "disabled" });
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual(before);
    await expect(readState(db, channelId)).resolves.toEqual(stateBefore);
    await expect(readProgress(db)).resolves.toEqual(progress);
    await expect(
      db.selectFrom("programming_blocks").select("id").execute(),
    ).resolves.toEqual([{ id: programmingBlockFixture.id }]);
    expect(log.lines).toEqual([]);
  });
});

describe("ScheduleService.applyInputChange", () => {
  // Creates the scenario's collection block through the repository, as the block route does.
  function createBlock(
    db: Kysely<DatabaseSchema>,
    channelId: string,
    collectionId: string,
  ) {
    const blocks = new ProgrammingBlockRepository(db, {
      createId: () => "block-001",
    });
    return blockChange(channelId, "created", (trx, effectiveNow) =>
      blocks.create(
        trx,
        channelId,
        {
          kind: "collection",
          mediaCollectionId: collectionId,
          playbackMode: "chronological",
        },
        effectiveNow,
      ),
    );
  }

  it("commits the change with the first chunk, then completes coverage", async () => {
    const { db, channelId, collectionId, service, log } = await setup(
      { source: null, items: [{ durationMs: 10 * HOUR }] },
      3,
    );

    const value = await service.applyInputChange(
      log,
      "block_created",
      createBlock(db, channelId, collectionId),
    );

    expect(value).toMatchObject({ kind: "created", block: { createdAt: T0 } });
    const entries = await readScheduleEntries(db, channelId);
    expect(entries).toHaveLength(8);
    expect(entries[0]?.starts_at).toBe(T0);
    expectContiguous(entries);
    await expect(readState(db, channelId)).resolves.toMatchObject({
      anchor_time: T0,
      schedule_revision: 3,
    });
    expect(log.lines).toEqual([
      {
        level: "info",
        fields: {
          channelId,
          reason: "block_created",
          result: covered(3),
        },
        message: expect.any(String),
      },
    ]);
  });

  it("rolls back the change when its first chunk fails", async () => {
    const { db, channelId, collectionId, service, log } = await setup({
      source: null,
    });
    await sql`
      create trigger fail_state_write before insert on channel_schedule_states
      begin select raise(abort, 'injected failure'); end
    `.execute(db);

    await expect(
      service.applyInputChange(
        log,
        "block_created",
        createBlock(db, channelId, collectionId),
      ),
    ).rejects.toThrow(/injected failure/);

    await expect(
      db.selectFrom("programming_blocks").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual([]);
  });

  it("keeps the committed change when completing coverage later fails", async () => {
    const { db, channelId, collectionId, service, log } = await setup(
      { source: null, items: [{ durationMs: 10 * HOUR }] },
      3,
    );
    // The first chunk creates state; only the follow-up chunks update it.
    await sql`
      create trigger fail_state_update before update on channel_schedule_states
      begin select raise(abort, 'injected failure'); end
    `.execute(db);

    const value = await service.applyInputChange(
      log,
      "block_created",
      createBlock(db, channelId, collectionId),
    );

    expect(value).toMatchObject({ kind: "created" });
    await expect(readScheduleEntries(db, channelId)).resolves.toHaveLength(3);
    expect(log.lines).toEqual([
      {
        level: "warn",
        fields: {
          channelId,
          reason: "block_created",
          err: expect.objectContaining({
            message: expect.stringMatching(/injected failure/),
          }),
        },
        message: expect.any(String),
      },
    ]);
  });

  it.each([
    ["a disabled channel", { enabled: false }],
    ["a source with no schedulable media", { items: [] }],
  ])(
    "commits the change without schedule state for %s",
    async (_, scenario) => {
      const { db, channelId, collectionId, service, log } = await setup({
        source: null,
        ...scenario,
      });

      const value = await service.applyInputChange(
        log,
        "block_created",
        createBlock(db, channelId, collectionId),
      );

      expect(value).toMatchObject({ kind: "created" });
      await expect(
        db.selectFrom("programming_blocks").select("id").execute(),
      ).resolves.toEqual([{ id: "block-001" }]);
      await expect(readState(db, channelId)).resolves.toBeUndefined();
      await expect(readScheduleEntries(db, channelId)).resolves.toEqual([]);
    },
  );

  it("never gives the change a time before the latest schedule mutation", async () => {
    const { channelId, clock, service, log } = await setup();
    clock.set(T0 + 2 * HOUR);
    await service.ensureCoverage(channelId, log);
    clock.set(T0 + HOUR);
    const seen: number[] = [];

    await service.applyInputChange(log, "block_created", async (_, now) => {
      seen.push(now);
      return { value: undefined, affectedChannelIds: [] };
    });

    expect(seen).toEqual([T0 + 2 * HOUR]);
    expect(log.lines).toEqual([
      {
        level: "warn",
        fields: { now: T0 + HOUR, effectiveNow: T0 + 2 * HOUR },
        message: expect.stringMatching(/clock/i),
      },
    ]);
  });
});

describe("ScheduleService regeneration", () => {
  const BLOCK_ID = programmingBlockFixture.id;

  // Swaps the scenario block's source through the repository, as the PATCH route does.
  function changeSource(channelId: string, source: ProgrammingBlockSource) {
    return blockChange(channelId, "replaced", (trx, now) =>
      new ProgrammingBlockRepository(trx).replaceSource(
        trx,
        channelId,
        BLOCK_ID,
        source,
        now,
      ),
    );
  }

  // Deletes the scenario block through the repository, as the DELETE route does.
  function deleteBlock(channelId: string) {
    return blockChange(channelId, "deleted", (trx) =>
      new ProgrammingBlockRepository(trx).delete(trx, channelId, BLOCK_ID),
    );
  }

  // The scenario collection played in a mode.
  function playCollection(
    mediaCollectionId: string,
    playbackMode: "chronological" | "random",
  ): ProgrammingBlockSource {
    return { kind: "collection", mediaCollectionId, playbackMode };
  }

  // Covers the horizon at T0, then moves the clock to `airingAt`.
  async function generatedSetup(
    airingAt: number,
    scenario: Partial<ScheduleScenarioOptions> = {},
  ) {
    const context = await setup(scenario);
    await context.service.ensureCoverage(context.channelId, context.log);
    const before = await readScheduleEntries(context.db, context.channelId);
    const stateBefore = (await readState(context.db, context.channelId))!;
    context.clock.set(airingAt);
    return { ...context, before, stateBefore };
  }

  // The info line one regeneration logs after its commit.
  function regenerationLine(fields: unknown) {
    return { level: "info", fields, message: expect.any(String) };
  }

  it("keeps the airing entry byte-for-byte and rebuilds from its end", async () => {
    // Episodes air 0–22, 22–45, and 45–69 minutes past T0.
    const { db, channelId, collectionId, service, log, before, stateBefore } =
      await generatedSetup(T0 + 30 * MINUTE);

    await service.applyInputChange(
      log,
      "block_changed",
      changeSource(channelId, playCollection(collectionId, "random")),
    );

    const after = await readScheduleEntries(db, channelId);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]).toMatchObject({
      starts_at: T0 + 45 * MINUTE,
      sequence_number: stateBefore.next_sequence_number,
      playback_mode: "random",
      playback_index: 0,
    });
    expectContiguous(after);
    await expect(readState(db, channelId)).resolves.toMatchObject({
      anchor_time: T0,
      seed: stateBefore.seed,
      schedule_revision: 2,
      updated_at: T0 + 30 * MINUTE,
    });
    expect(log.lines).toEqual([
      regenerationLine({
        channelId,
        reason: "block_changed",
        boundary: T0 + 45 * MINUTE,
        deletedEntryCount: before.length - 2,
        insertedEntryCount: after.length - 2,
        result: covered(2),
      }),
    ]);
  });

  it("starts at the effective current time when no entry covers it", async () => {
    const later = T0 + SCHEDULE_HORIZON_MS + 10 * HOUR;
    const { db, channelId, collectionId, service, log, before } =
      await generatedSetup(later);

    await service.applyInputChange(
      log,
      "block_changed",
      changeSource(channelId, playCollection(collectionId, "random")),
    );

    const after = await readScheduleEntries(db, channelId);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[before.length]).toMatchObject({
      starts_at: later,
      playback_mode: "random",
    });
    const coveredUntil = before.at(-1)?.ends_at;
    expect(log.lines).toEqual([
      {
        level: "warn",
        fields: {
          channelId,
          uncoveredFrom: coveredUntil,
          uncoveredUntil: later,
          deletedEntryCount: 0,
        },
        message: expect.stringMatching(/gap/i),
      },
      regenerationLine(
        expect.objectContaining({ boundary: later, deletedEntryCount: 0 }),
      ),
    ]);
  });

  it("reports no gap repair on a disabled channel whose coverage lapsed", async () => {
    const later = T0 + SCHEDULE_HORIZON_MS + 10 * HOUR;
    const { db, channelId, collectionId, service, log } =
      await generatedSetup(later);
    await db.updateTable("channels").set({ enabled: 0 }).execute();

    await service.applyInputChange(
      log,
      "block_changed",
      changeSource(channelId, playCollection(collectionId, "random")),
    );

    expect(log.lines.map((line) => line.level)).toEqual(["info"]);
  });

  it("restores progress from the earliest deleted entry, never replaying from the anchor", async () => {
    // Four hourly items: the horizon ends after position 3, leaving progress
    // at 0, while at 2.5 hours the first deleted entry is position 3.
    const { db, channelId, collectionId, service, log } = await generatedSetup(
      T0 + 2.5 * HOUR,
      { items: Array.from({ length: 4 }, () => ({ durationMs: HOUR })) },
    );
    await expect(readProgress(db)).resolves.toEqual([
      expect.objectContaining({ next_chronological_position: 0 }),
    ]);

    await service.applyInputChange(
      log,
      "block_changed",
      changeSource(channelId, playCollection(collectionId, "random")),
    );

    await expect(readProgress(db)).resolves.toEqual([
      expect.objectContaining({ next_chronological_position: 3 }),
    ]);
  });

  it("resumes chronological playback untouched by a random stretch", async () => {
    const { db, channelId, collectionId, clock, service, log } =
      await generatedSetup(T0 + 30 * MINUTE);
    await service.applyInputChange(
      log,
      "block_changed",
      changeSource(channelId, playCollection(collectionId, "random")),
    );
    // The first random entry airs from 45 minutes for at least 22 minutes.
    clock.set(T0 + 50 * MINUTE);

    await service.applyInputChange(
      log,
      "block_changed",
      changeSource(channelId, playCollection(collectionId, "chronological")),
    );

    const after = await readScheduleEntries(db, channelId);
    expect(after.slice(0, 4).map((entry) => entry.playback_mode)).toEqual([
      "chronological",
      "chronological",
      "random",
      "chronological",
    ]);
    expect(after[3]).toMatchObject({
      starts_at: after[2]?.ends_at,
      playback_index: 2,
      title: "Item 3",
    });
    // The deleted random stretch rewinds to its first deleted selection.
    await expect(readProgress(db)).resolves.toEqual([
      expect.objectContaining({ next_random_selection_index: 1 }),
    ]);
  });

  describe("membership modulo at restored position 3", () => {
    const HOURLY = Array.from({ length: 6 }, () => ({ durationMs: HOUR }));

    // Plays [A, B, C, D] hourly; at 2.5 hours C airs and D is the first deleted entry.
    async function fourMemberSetup() {
      const context = await setup({ items: HOURLY });
      await context.db
        .deleteFrom("media_collection_items")
        .where("position", ">=", 4)
        .execute();
      await context.service.ensureCoverage(context.channelId, context.log);
      context.clock.set(T0 + 2.5 * HOUR);
      return context;
    }

    it("replays B when [A, B, C, D] shrinks to [A, B] (3 mod 2 = 1)", async () => {
      const { db, channelId, collectionId, service, log } =
        await fourMemberSetup();

      await service.applyInputChange(
        log,
        "membership_changed",
        membershipChange(collectionId, ["item-001", "item-002"]),
      );

      const after = await readScheduleEntries(db, channelId);
      expect(after[3]).toMatchObject({
        starts_at: T0 + 3 * HOUR,
        playback_index: 1,
        media_item_id: "item-002",
      });
    });

    it("continues at D, skipping nothing, when [A, B, C, D] grows to [A, B, C, D, E, F]", async () => {
      const { db, channelId, collectionId, service, log } =
        await fourMemberSetup();

      await service.applyInputChange(
        log,
        "membership_changed",
        membershipChange(collectionId, [
          "item-001",
          "item-002",
          "item-003",
          "item-004",
          "item-005",
          "item-006",
        ]),
      );

      const after = await readScheduleEntries(db, channelId);
      expect(after.slice(3, 6).map((entry) => entry.media_item_id)).toEqual([
        "item-004",
        "item-005",
        "item-006",
      ]);
    });
  });

  it("keeps the airing entry without its block when the block is deleted", async () => {
    const { db, channelId, service, log } = await generatedSetup(
      T0 + 30 * MINUTE,
    );

    await service.applyInputChange(
      log,
      "block_deleted",
      deleteBlock(channelId),
    );

    const after = await readScheduleEntries(db, channelId);
    expect(after.map((entry) => entry.programming_block_id)).toEqual([
      null,
      null,
    ]);
    await expect(readState(db, channelId)).resolves.toMatchObject({
      last_generated_through: T0 + 45 * MINUTE,
      schedule_revision: 2,
    });
    await expect(service.ensureCoverage(channelId, log)).resolves.toEqual({
      kind: "unschedulable",
      reason: "no_programming_block",
    });
  });

  it("resumes after the airing entry when a block is created again", async () => {
    const { db, channelId, collectionId, service, log } = await generatedSetup(
      T0 + 30 * MINUTE,
    );
    await service.applyInputChange(
      log,
      "block_deleted",
      deleteBlock(channelId),
    );

    await service.applyInputChange(
      log,
      "block_created",
      blockChange(channelId, "created", (trx, now) =>
        new ProgrammingBlockRepository(trx).create(
          trx,
          channelId,
          playCollection(collectionId, "chronological"),
          now,
        ),
      ),
    );

    const after = await readScheduleEntries(db, channelId);
    expect(after[2]).toMatchObject({
      starts_at: T0 + 45 * MINUTE,
      playback_index: 2,
    });
    expectContiguous(after);
  });

  it("lets a collection be deleted after its block switched source", async () => {
    const { db, channelId, collectionId, service, log } = await generatedSetup(
      T0 + 30 * MINUTE,
    );
    await service.applyInputChange(
      log,
      "block_changed",
      changeSource(channelId, { kind: "media_item", mediaItemId: "item-001" }),
    );

    await expect(
      new MediaCollectionRepository(db).delete(collectionId),
    ).resolves.toEqual({ kind: "deleted" });

    const after = await readScheduleEntries(db, channelId);
    expect(after.every((entry) => entry.media_collection_id === null)).toBe(
      true,
    );
    // The playback index stays behind as history.
    expect(after[1]?.playback_index).toBe(1);
  });

  it("deletes future entries and restores progress without generating on a disabled channel", async () => {
    const { db, channelId, collectionId, service, log } = await generatedSetup(
      T0 + 30 * MINUTE,
    );
    await db.updateTable("channels").set({ enabled: 0 }).execute();

    await service.applyInputChange(
      log,
      "block_changed",
      changeSource(channelId, playCollection(collectionId, "random")),
    );

    await expect(readScheduleEntries(db, channelId)).resolves.toHaveLength(2);
    await expect(readProgress(db)).resolves.toEqual([
      expect.objectContaining({ next_chronological_position: 2 }),
    ]);
    await expect(readState(db, channelId)).resolves.toMatchObject({
      last_generated_through: T0 + 45 * MINUTE,
      schedule_revision: 2,
    });
    expect(log.lines).toEqual([
      regenerationLine(
        expect.objectContaining({
          insertedEntryCount: 0,
          result: { kind: "disabled" },
        }),
      ),
    ]);
  });

  it("rolls back the input change when regeneration fails", async () => {
    const { db, channelId, collectionId, service, log, before } =
      await generatedSetup(T0 + 30 * MINUTE);
    await sql`
      create trigger fail_entry_delete before delete on schedule_entries
      begin select raise(abort, 'injected failure'); end
    `.execute(db);

    await expect(
      service.applyInputChange(
        log,
        "block_changed",
        changeSource(channelId, playCollection(collectionId, "random")),
      ),
    ).rejects.toThrow(/injected failure/);

    await expect(
      db.selectFrom("programming_blocks").select("playback_mode").execute(),
    ).resolves.toEqual([{ playback_mode: "chronological" }]);
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual(before);
  });

  it.each(["regeneration", "extension"] as const)(
    "never overlaps or duplicates sequence numbers when %s takes write authority first",
    async (first) => {
      const dataDirectory = await createTemporaryDirectory();
      const a = (await openTestDatabase(dataDirectory)).db;
      const b = (await openTestDatabase(dataDirectory)).db;
      const { channelId, collectionId } = await seedScheduleScenario(a, {
        items: EPISODES,
        source: "chronological",
      });
      await new ScheduleService(a, { now: () => T0 }).ensureCoverage(
        channelId,
        recordingLog(),
      );
      const barrier = createBarrier();
      // A day later, so extension has work to do too.
      const now = () => T0 + 24 * HOUR + 30 * MINUTE;
      const serviceA = new ScheduleService(a, {
        now,
        createId: sequentialIds("a"),
        transactionHooks: { afterBegin: () => barrier.wait() },
      });
      // B releases A on its first busy attempt, so A commits while B retries.
      const serviceB = new ScheduleService(b, {
        now,
        createId: sequentialIds("b"),
        transactionHooks: { onBusy: () => barrier.release() },
      });
      const regenerate = (service: ScheduleService) =>
        service.applyInputChange(
          recordingLog(),
          "block_changed",
          changeSource(channelId, playCollection(collectionId, "random")),
        );
      const extend = (service: ScheduleService) =>
        service.ensureCoverage(channelId, recordingLog());
      const [runA, runB] =
        first === "regeneration" ? [regenerate, extend] : [extend, regenerate];

      const running = runA(serviceA);
      await barrier.reached;
      await Promise.resolve(runB(serviceB)).catch((error: unknown) => {
        if (!(error instanceof WriteAuthorityBusyError)) throw error;
      });
      barrier.release();
      await running;

      const entries = await readScheduleEntries(a, channelId);
      expectContiguous(entries);
      expect(new Set(entries.map((entry) => entry.sequence_number)).size).toBe(
        entries.length,
      );
    },
  );
});

describe("ScheduleService.regenerate", () => {
  it("rebuilds future entries from the boundary and reports coverage", async () => {
    const { db, channelId, clock, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const before = await readScheduleEntries(db, channelId);
    clock.set(T0 + 30 * MINUTE);

    const result = await service.regenerate(channelId, log);

    expect(result).toEqual(covered(2));
    const after = await readScheduleEntries(db, channelId);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    // Restored progress rebuilds identical programming; only the rows are new.
    const programming = (entries: typeof before) =>
      entries.map(({ media_item_id, starts_at, ends_at }) => ({
        media_item_id,
        starts_at,
        ends_at,
      }));
    expect(programming(after.slice(0, before.length))).toEqual(
      programming(before),
    );
    expect(after[2]?.sequence_number).toBe(before.length);
    expect(log.lines).toEqual([
      {
        level: "info",
        fields: expect.objectContaining({
          channelId,
          reason: "manual",
          boundary: T0 + 45 * MINUTE,
          result: covered(2),
        }),
        message: expect.any(String),
      },
    ]);
  });

  it("generates the first schedule for a channel without state", async () => {
    const { channelId, service, log } = await setup();

    await expect(service.regenerate(channelId, log)).resolves.toEqual(
      covered(1),
    );
  });

  it.each([
    ["a missing channel", "missing", { kind: "channel_not_found" }],
    ["a disabled channel", "disabled", { kind: "disabled" }],
  ] as const)("writes nothing for %s", async (_, variant, expected) => {
    const { db, channelId, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const before = await readScheduleEntries(db, channelId);
    if (variant === "disabled") {
      await db.updateTable("channels").set({ enabled: 0 }).execute();
    }

    await expect(
      service.regenerate(variant === "missing" ? "missing" : channelId, log),
    ).resolves.toEqual(expected);
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual(before);
    expect(log.lines).toEqual([]);
  });

  it("rejects a requested instant beyond the request limit without writing", async () => {
    const { db, channelId, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const before = await readScheduleEntries(db, channelId);

    await expect(
      service.regenerate(channelId, log, T0 + SCHEDULE_REQUEST_LIMIT_MS + 1),
    ).resolves.toEqual({
      kind: "through_out_of_range",
      latestThrough: T0 + SCHEDULE_REQUEST_LIMIT_MS,
    });
    await expect(readScheduleEntries(db, channelId)).resolves.toEqual(before);
  });
});

describe("ScheduleService.readWindow", () => {
  it("returns every entry overlapping the window in start order, with the revision", async () => {
    const { db, channelId, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const [, second, third] = await readScheduleEntries(db, channelId);

    // Episodes run 0–22, 22–45, and 45–69 minutes past the anchor.
    const window = await service.readWindow(
      channelId,
      T0 + 30 * MINUTE,
      T0 + 50 * MINUTE,
    );

    expect(window).toEqual({
      scheduleRevision: 1,
      entries: [second, third].map((row) => ({
        id: row.id,
        channelId,
        mediaItemId: row.media_item_id,
        title: row.title,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        durationMs: row.duration_ms,
        sequenceNumber: row.sequence_number,
        programmingBlockId: row.programming_block_id,
        mediaCollectionId: row.media_collection_id,
        playbackMode: row.playback_mode,
        playbackIndex: row.playback_index,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  });

  it("excludes entries that only touch the window's edges", async () => {
    const { channelId, service, log } = await setup();
    await service.ensureCoverage(channelId, log);

    const window = await service.readWindow(
      channelId,
      T0 + 22 * MINUTE,
      T0 + 45 * MINUTE,
    );

    expect(window.entries.map((entry) => entry.startsAt)).toEqual([
      T0 + 22 * MINUTE,
    ]);
  });

  it("reads no revision and no entries before the first generation", async () => {
    const { channelId, service } = await setup();

    await expect(service.readWindow(channelId, T0, T0 + HOUR)).resolves.toEqual(
      { scheduleRevision: null, entries: [] },
    );
  });
});

describe("ScheduleService.ensureAllEnabled", () => {
  // Adds another channel with a block over the scenario's collection.
  async function addChannel(
    db: Kysely<DatabaseSchema>,
    id: string,
    number: string,
    enabled: boolean,
  ) {
    await db
      .insertInto("channels")
      .values({ ...channelFixture, id, number, enabled: enabled ? 1 : 0 })
      .execute();
    await db
      .insertInto("programming_blocks")
      .values({ ...programmingBlockFixture, id: `block-${id}`, channel_id: id })
      .execute();
  }

  it("covers the horizon for every enabled channel and skips disabled ones", async () => {
    const { db, channelId, service, log } = await setup();
    await addChannel(db, "channel-enabled", "70", true);
    await addChannel(db, "channel-disabled", "71", false);

    await service.ensureAllEnabled(log);

    for (const id of [channelId, "channel-enabled"]) {
      const state = await readState(db, id);
      expect(state?.last_generated_through).toBeGreaterThanOrEqual(
        T0 + SCHEDULE_HORIZON_MS,
      );
    }
    expect(await readState(db, "channel-disabled")).toBeUndefined();
    expect(await readScheduleEntries(db, "channel-disabled")).toEqual([]);
  });

  it("logs a channel's failure and still covers the rest", async () => {
    const { db, channelId, service, log } = await setup();
    await addChannel(db, "channel-enabled", "70", true);
    const failure = new Error("boom");
    const ensure = service.ensureCoverage.bind(service);
    vi.spyOn(service, "ensureCoverage").mockImplementation((id, ...rest) =>
      id === channelId ? Promise.reject(failure) : ensure(id, ...rest),
    );

    await expect(service.ensureAllEnabled(log)).resolves.toBeUndefined();

    expect(await readState(db, "channel-enabled")).toBeDefined();
    expect(log.lines).toContainEqual({
      level: "warn",
      fields: { channelId, err: failure },
      message: "Ensuring schedule coverage failed",
    });
  });

  it("logs, rather than throws, when listing enabled channels fails", async () => {
    const { db, service, log } = await setup();
    const failure = new Error("database unavailable");
    vi.spyOn(db, "selectFrom").mockImplementationOnce(() => {
      throw failure;
    });

    await expect(service.ensureAllEnabled(log)).resolves.toBeUndefined();

    expect(log.lines).toContainEqual({
      level: "warn",
      fields: { err: failure },
      message: "Listing enabled channels for schedule coverage failed",
    });
  });
});
