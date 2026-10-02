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
import { ProgrammingBlockRepository } from "../programming-blocks/programming-block-repository.js";
import {
  SCHEDULE_REQUEST_LIMIT_MS,
  ScheduleService,
} from "./schedule-service.js";

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
    const entries = await readEntries(db, channelId);
    const state = await readState(db, channelId);
    clock.advance(MINUTE);

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual(covered(1));
    await expect(readEntries(db, channelId)).resolves.toEqual(entries);
    await expect(readState(db, channelId)).resolves.toEqual(state);
  });

  it("extends coverage as time advances without changing existing entries", async () => {
    const { db, channelId, clock, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const before = await readEntries(db, channelId);
    clock.advance(6 * HOUR);

    const result = await service.ensureCoverage(channelId, log);

    expect(result).toEqual(covered(2));
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

    expect(result).toEqual(covered(3));
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

    expect(results).toEqual([covered(1), covered(1)]);
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

    await expect(first).resolves.toEqual(covered(1));
    if (second instanceof WriteAuthorityBusyError) {
      expect(second.retryable).toBe(true);
    } else {
      expect(second).toEqual(covered(1));
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

    expect(result).toEqual(covered(3));
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
    await expect(readEntries(db, channelId)).resolves.toEqual([]);
    await expect(readProgress(db)).resolves.toEqual([]);
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
    return async (trx: Kysely<DatabaseSchema>, effectiveNow: number) => {
      const result = await blocks.create(
        trx,
        channelId,
        {
          kind: "collection",
          mediaCollectionId: collectionId,
          playbackMode: "chronological",
        },
        effectiveNow,
      );
      return { value: result, affectedChannelIds: [channelId] };
    };
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
    const entries = await readEntries(db, channelId);
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
    await expect(readEntries(db, channelId)).resolves.toEqual([]);
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
    await expect(readEntries(db, channelId)).resolves.toHaveLength(3);
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
      await expect(readEntries(db, channelId)).resolves.toEqual([]);
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

describe("ScheduleService.readWindow", () => {
  it("returns every entry overlapping the window in start order, with the revision", async () => {
    const { db, channelId, service, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const [, second, third] = await readEntries(db, channelId);

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
