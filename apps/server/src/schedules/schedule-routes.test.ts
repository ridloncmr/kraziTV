import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { send, iso } from "../testing/api-requests.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { holdWriteAuthority } from "../testing/hold-write-authority.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import {
  seedScheduleScenario,
  readScheduleEntries,
  type ScheduleScenarioOptions,
} from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
  startTestServer,
} from "../testing/test-environment.js";
import { SCHEDULE_REQUEST_LIMIT_MS } from "./schedule-coverage.js";
import { ScheduleService } from "./schedule-service.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = FIXTURE_TIME;
const EPISODES = [22, 23, 24].map((minutes) => ({
  durationMs: minutes * MINUTE,
}));
// The channel seedScheduleScenario writes.
const CHANNEL_ID = "channel-fixture-001";
const SCHEDULE_URL = `/channels/${CHANNEL_ID}/schedule`;
const GENERATE_URL = `${SCHEDULE_URL}/generate`;

// Boots the real composition over three chronological episodes on a manual clock.
async function startServer(scenario: Partial<ScheduleScenarioOptions> = {}) {
  const dataDirectory = await createTemporaryDirectory();
  const clock = manualClock(T0);
  const { server, db } = await startTestServer({
    dataDirectory,
    seed: async (db) => {
      await seedScheduleScenario(db, {
        items: EPISODES,
        source: "chronological",
        ...scenario,
      });
    },
    overrides: (db) => ({
      schedules: new ScheduleService(db, {
        now: clock.now,
        createId: sequentialIds("entry"),
      }),
    }),
  });
  return { server, db, clock, dataDirectory };
}

// Reads the one channel's schedule state row.
function readState(db: Kysely<DatabaseSchema>) {
  return db
    .selectFrom("channel_schedule_states")
    .selectAll()
    .executeTakeFirstOrThrow();
}

// Builds a window query from epoch milliseconds.
function windowUrl(start: number, end: number, url = SCHEDULE_URL): string {
  return `${url}?start=${iso(start)}&end=${iso(end)}`;
}

describe("GET /channels/:id/schedule", () => {
  it("generates coverage and returns the window's entries with API timestamps", async () => {
    const { server } = await startServer();

    const { status, body } = await send(
      server,
      "GET",
      windowUrl(T0, T0 + 30 * MINUTE),
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      scheduleRevision: 1,
      entries: [
        {
          id: "entry-001",
          channelId: CHANNEL_ID,
          mediaItemId: "item-001",
          title: "Item 1",
          startsAt: iso(T0),
          endsAt: iso(T0 + 22 * MINUTE),
          durationMs: 22 * MINUTE,
          sequenceNumber: 0,
          programmingBlockId: "block-fixture-001",
          mediaCollectionId: "collection-fixture-001",
          playbackMode: "chronological",
          playbackIndex: 0,
          createdAt: iso(T0),
          updatedAt: iso(T0),
        },
        expect.objectContaining({
          startsAt: iso(T0 + 22 * MINUTE),
          endsAt: iso(T0 + 45 * MINUTE),
        }),
      ],
    });
  });

  it("returns identical entries where overlapping windows meet, including entries crossing an edge", async () => {
    // A 71-minute cycle, so an entry straddles every window edge below.
    const { server } = await startServer({
      items: [22, 23, 26].map((minutes) => ({ durationMs: minutes * MINUTE })),
    });

    type Entry = { startsAt: string; endsAt: string };
    // ISO instants in one zone and precision compare correctly as strings.
    const read = async (start: number, end: number) => {
      const { body } = await send(server, "GET", windowUrl(start, end));
      const entries = (body as { entries: Entry[] }).entries;
      expect(entries[0].startsAt < iso(start)).toBe(true);
      expect(entries[entries.length - 1].endsAt > iso(end)).toBe(true);
      return entries;
    };
    const overlapping = (entries: Entry[]) =>
      entries.filter(
        (entry) =>
          entry.startsAt < iso(T0 + 18 * HOUR) &&
          entry.endsAt > iso(T0 + 15 * HOUR),
      );

    const early = await read(T0 + 12 * HOUR, T0 + 18 * HOUR);
    const late = await read(T0 + 15 * HOUR, T0 + 21 * HOUR);

    expect(overlapping(early).length).toBeGreaterThan(0);
    expect(overlapping(early)).toEqual(overlapping(late));
  });

  it("leaves the revision unchanged across repeated reads", async () => {
    const { server, clock } = await startServer();
    const url = windowUrl(T0, T0 + HOUR);

    const first = await send(server, "GET", url);
    clock.advance(MINUTE);
    const second = await send(server, "GET", url);

    expect(second).toEqual(first);
  });

  it.each([
    ["a reversed range", windowUrl(T0 + HOUR, T0)],
    ["an empty range", windowUrl(T0, T0)],
    [
      "a range longer than 7 days",
      windowUrl(T0, T0 + SCHEDULE_REQUEST_LIMIT_MS + 1),
    ],
    [
      "an instant with an offset",
      `${SCHEDULE_URL}?start=2024-01-01T02:00:00%2B02:00&end=${iso(T0 + HOUR)}`,
    ],
    [
      "an instant without a zone",
      `${SCHEDULE_URL}?start=2024-01-01T00:00:00&end=${iso(T0 + HOUR)}`,
    ],
    ["a missing end", `${SCHEDULE_URL}?start=${iso(T0)}`],
  ])("rejects %s", async (_, url) => {
    const { server, db } = await startServer();
    // Startup ensures coverage, so compare against what it wrote.
    await server.ready();
    const before = await readScheduleEntries(db, CHANNEL_ID);

    const { status, body } = await send(server, "GET", url);

    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(before);
  });

  it("accepts a range of exactly 7 days", async () => {
    const { server } = await startServer();

    const { status } = await send(
      server,
      "GET",
      windowUrl(T0, T0 + SCHEDULE_REQUEST_LIMIT_MS),
    );

    expect(status).toBe(200);
  });

  it("serves a disabled channel's existing entries without generating", async () => {
    const { server } = await startServer({ enabled: false });

    await expect(
      send(server, "GET", windowUrl(T0, T0 + HOUR)),
    ).resolves.toEqual({
      status: 200,
      body: { scheduleRevision: null, entries: [] },
    });
  });

  it.each([
    ["no programming block", { source: null }, "no_programming_block"],
    ["no schedulable media", { items: [] }, "no_schedulable_media"],
  ])(
    "reports a channel with %s as unschedulable",
    async (_, scenario, reason) => {
      const { server } = await startServer(scenario);

      const { status, body } = await send(
        server,
        "GET",
        windowUrl(T0, T0 + HOUR),
      );

      expect(status).toBe(409);
      expect(body.error).toMatchObject({
        code: "channel_unschedulable",
        reason,
      });
    },
  );

  it("still serves entries already in a window once the channel becomes unschedulable", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "GET", windowUrl(T0, T0 + HOUR));
    await db.deleteFrom("programming_blocks").execute();
    clock.advance(HOUR);

    const covered = await send(server, "GET", windowUrl(T0, T0 + HOUR));
    const uncovered = await send(
      server,
      "GET",
      windowUrl(
        T0 + SCHEDULE_HORIZON_MS + 2 * HOUR,
        T0 + SCHEDULE_HORIZON_MS + 3 * HOUR,
      ),
    );

    expect(covered.status).toBe(200);
    expect(covered.body.entries.length).toBeGreaterThan(0);
    expect(uncovered.status).toBe(409);
    expect(uncovered.body.error.reason).toBe("no_programming_block");
  });

  it("repairs lapsed coverage from now and still serves the old window", async () => {
    const { server, clock } = await startServer();
    const old = await send(server, "GET", windowUrl(T0, T0 + HOUR));
    const later = T0 + SCHEDULE_HORIZON_MS + 24 * HOUR;
    clock.set(later);

    const repaired = await send(server, "GET", windowUrl(later, later + HOUR));
    const oldAgain = await send(server, "GET", windowUrl(T0, T0 + HOUR));

    expect(repaired.status).toBe(200);
    expect(repaired.body.scheduleRevision).toBe(2);
    expect(repaired.body.entries[0].startsAt).toBe(iso(later));
    expect(oldAgain.body.entries).toEqual(old.body.entries);
  });

  it("never deletes or replaces entries when reading a covered window", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "GET", windowUrl(T0, T0 + HOUR));
    const before = await readScheduleEntries(db, CHANNEL_ID);
    clock.advance(6 * HOUR);

    const { status } = await send(
      server,
      "GET",
      windowUrl(T0 + 6 * HOUR, T0 + 7 * HOUR),
    );

    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(status).toBe(200);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("reports an unknown channel", async () => {
    const { server } = await startServer();

    const { status, body } = await send(
      server,
      "GET",
      windowUrl(T0, T0 + HOUR, "/channels/missing/schedule"),
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe("channel_not_found");
  });
});

describe("POST /channels/:id/schedule/generate", () => {
  it("covers the horizon and reports the revision and coverage end", async () => {
    const { server, db } = await startServer();

    const { status, body } = await send(server, "POST", GENERATE_URL, {});

    const state = await db
      .selectFrom("channel_schedule_states")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(status).toBe(200);
    expect(body).toEqual({
      scheduleRevision: 1,
      generatedThrough: iso(state.last_generated_through),
    });
    expect(state.last_generated_through).toBeGreaterThanOrEqual(
      T0 + SCHEDULE_HORIZON_MS,
    );
  });

  it("extends coverage through a later instant without rewriting existing entries", async () => {
    const { server, db } = await startServer();
    await send(server, "POST", GENERATE_URL, {});
    const before = await db
      .selectFrom("schedule_entries")
      .selectAll()
      .execute();
    const through = T0 + SCHEDULE_HORIZON_MS + 24 * HOUR;

    const { status, body } = await send(server, "POST", GENERATE_URL, {
      through: iso(through),
    });

    const after = await db
      .selectFrom("schedule_entries")
      .selectAll()
      .orderBy("sequence_number")
      .execute();
    expect(status).toBe(200);
    expect(body.scheduleRevision).toBeGreaterThan(1);
    expect(
      Date.parse((body as { generatedThrough: string }).generatedThrough),
    ).toBeGreaterThanOrEqual(through);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("leaves the revision unchanged when coverage already reaches the request", async () => {
    const { server, clock } = await startServer();
    const first = await send(server, "POST", GENERATE_URL, {});
    clock.advance(MINUTE);

    const repeated = await send(server, "POST", GENERATE_URL, {});
    const past = await send(server, "POST", GENERATE_URL, {
      through: iso(T0 - HOUR),
    });

    expect(repeated).toEqual(first);
    expect(past).toEqual(first);
  });

  it.each([
    [
      "a through past the request limit",
      { through: iso(T0 + SCHEDULE_REQUEST_LIMIT_MS + 1) },
    ],
    ["a through with an offset", { through: "2024-01-02T02:00:00+02:00" }],
    ["an unknown field", { rebuild: true }],
    ["a regenerate flag that is not a boolean", { regenerate: "yes" }],
  ])("rejects %s without writing", async (_, payload) => {
    const { server, db } = await startServer();
    // Startup ensures coverage, so compare against what it wrote.
    await server.ready();
    const before = await readState(db);

    const { status, body } = await send(server, "POST", GENERATE_URL, payload);

    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    await expect(readState(db)).resolves.toEqual(before);
  });

  it("rejects a disabled channel", async () => {
    const { server } = await startServer({ enabled: false });

    const { status, body } = await send(server, "POST", GENERATE_URL, {});

    expect(status).toBe(409);
    expect(body.error.code).toBe("channel_disabled");
  });

  it("regenerates future entries after the airing entry when asked", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "POST", GENERATE_URL, {});
    const before = await readScheduleEntries(db, CHANNEL_ID);
    clock.set(T0 + 30 * MINUTE);

    const { status, body } = await send(server, "POST", GENERATE_URL, {
      regenerate: true,
    });

    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(status).toBe(200);
    expect(body.scheduleRevision).toBe(2);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]).toMatchObject({
      starts_at: T0 + 45 * MINUTE,
      sequence_number: before.length,
    });
  });

  it("rejects regenerating a disabled channel without writing", async () => {
    const { server, db } = await startServer();
    await send(server, "POST", GENERATE_URL, {});
    await db.updateTable("channels").set({ enabled: 0 }).execute();
    const before = await readScheduleEntries(db, CHANNEL_ID);

    const { status, body } = await send(server, "POST", GENERATE_URL, {
      regenerate: true,
    });

    expect(status).toBe(409);
    expect(body.error.code).toBe("channel_disabled");
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(before);
  });

  it("regenerates channels drawing from a collection when its membership changes", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "POST", GENERATE_URL, {});
    clock.set(T0 + 30 * MINUTE);

    const { status } = await send(
      server,
      "PUT",
      "/media-collections/collection-fixture-001/items",
      { mediaItemIds: ["item-001"] },
    );

    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(status).toBe(200);
    expect(
      after.slice(2, 5).map((entry) => [entry.starts_at, entry.media_item_id]),
    ).toEqual([
      [T0 + 45 * MINUTE, "item-001"],
      [T0 + 67 * MINUTE, "item-001"],
      [T0 + 89 * MINUTE, "item-001"],
    ]);
  });

  it.each([
    ["no programming block", { source: null }, "no_programming_block"],
    ["no schedulable media", { items: [] }, "no_schedulable_media"],
  ])(
    "reports a channel with %s as unschedulable",
    async (_, scenario, reason) => {
      const { server } = await startServer(scenario);

      const { status, body } = await send(server, "POST", GENERATE_URL, {});

      expect(status).toBe(409);
      expect(body.error).toMatchObject({
        code: "channel_unschedulable",
        reason,
      });
    },
  );

  it("repairs lapsed coverage from now", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "POST", GENERATE_URL, {});
    const later = T0 + SCHEDULE_HORIZON_MS + 24 * HOUR;
    clock.set(later);

    const { status, body } = await send(server, "POST", GENERATE_URL, {});

    const state = await db
      .selectFrom("channel_schedule_states")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(status).toBe(200);
    expect(body).toEqual({
      scheduleRevision: 2,
      generatedThrough: iso(state.last_generated_through),
    });
    expect(state.last_generated_through).toBeGreaterThanOrEqual(
      later + SCHEDULE_HORIZON_MS,
    );
  });

  it("reports an unknown channel", async () => {
    const { server } = await startServer();

    const { status, body } = await send(
      server,
      "POST",
      "/channels/missing/schedule/generate",
      {},
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe("channel_not_found");
  });

  it("answers 503 retryable while another connection holds write authority", async () => {
    const { server, dataDirectory } = await startServer();
    const other = await openTestDatabase(dataDirectory);
    const holder = await holdWriteAuthority(other.db);
    try {
      const generate = await send(server, "POST", GENERATE_URL, {});
      const read = await send(server, "GET", windowUrl(T0, T0 + HOUR));

      for (const { status, body } of [generate, read]) {
        expect(status).toBe(503);
        expect(body.error).toMatchObject({
          code: "schedule_busy",
          retryable: true,
        });
      }
    } finally {
      await holder.release();
    }
  });
});

describe("PATCH /channels/:id schedule maintenance", () => {
  const CHANNEL_URL = `/channels/${CHANNEL_ID}`;

  it("keeps the anchor and seed and repairs from now when re-enabled after a lapse", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "POST", GENERATE_URL, {});
    const before = await readState(db);
    await send(server, "PATCH", CHANNEL_URL, { enabled: false });
    const later = T0 + 6 * 7 * 24 * HOUR;
    clock.set(later);

    const { status, body } = await send(server, "PATCH", CHANNEL_URL, {
      enabled: true,
    });

    expect(status).toBe(200);
    expect(body.enabled).toBe(true);
    const after = await readState(db);
    expect(after).toMatchObject({
      anchor_time: before.anchor_time,
      seed: before.seed,
      schedule_revision: before.schedule_revision + 1,
    });
    expect(after.last_generated_through).toBeGreaterThanOrEqual(
      later + SCHEDULE_HORIZON_MS,
    );
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    expect(entries[before.next_sequence_number]?.starts_at).toBe(later);
  });

  it("simply extends coverage when re-enabled before a lapse", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "POST", GENERATE_URL, {});
    const before = await readScheduleEntries(db, CHANNEL_ID);
    const stateBefore = await readState(db);
    await send(server, "PATCH", CHANNEL_URL, { enabled: false });
    clock.advance(6 * HOUR);

    await send(server, "PATCH", CHANNEL_URL, { enabled: true });

    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[before.length]?.starts_at).toBe(
      stateBefore.last_generated_through,
    );
    await expect(readState(db)).resolves.toMatchObject({
      schedule_revision: stateBefore.schedule_revision + 1,
    });
  });

  it("leaves a disabled channel's schedule untouched", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "POST", GENERATE_URL, {});
    const before = await readScheduleEntries(db, CHANNEL_ID);
    const stateBefore = await readState(db);
    clock.advance(6 * HOUR);

    await send(server, "PATCH", CHANNEL_URL, { enabled: false });
    await send(server, "PATCH", CHANNEL_URL, { name: "Renamed" });

    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(before);
    await expect(readState(db)).resolves.toEqual(stateBefore);
  });

  it("logs, rather than returns, a coverage failure after the enable commits", async () => {
    const lines: string[] = [];
    const { server, db } = await startTestServer({
      seed: async (db) => {
        await seedScheduleScenario(db, {
          items: EPISODES,
          source: "chronological",
          enabled: false,
        });
      },
      overrides: (db) => ({
        schedules: new ScheduleService(db, {
          now: manualClock(T0).now,
          transactionHooks: {
            afterBegin: () => {
              throw new Error("coverage failed");
            },
          },
        }),
      }),
      logger: { level: "warn", stream: { write: (line) => lines.push(line) } },
    });

    const { status, body } = await send(server, "PATCH", CHANNEL_URL, {
      enabled: true,
    });

    expect(status).toBe(200);
    expect(body.enabled).toBe(true);
    await expect(
      db.selectFrom("channels").select("enabled").executeTakeFirstOrThrow(),
    ).resolves.toEqual({ enabled: 1 });
    // The logger records only warn and above, so any line here is a warning.
    expect(lines.map((line) => JSON.parse(line) as unknown)).toContainEqual(
      expect.objectContaining({
        channelId: CHANNEL_ID,
        msg: expect.stringMatching(/schedule coverage failed/i) as unknown,
      }),
    );
  });
});

describe("server startup schedule maintenance", () => {
  const DAY = 24 * HOUR;

  // Reopens the same data directory, as a process restart would, on the given clock.
  async function restartServer(dataDirectory: string, now: () => number) {
    return startTestServer({
      dataDirectory,
      overrides: (db) => ({
        schedules: new ScheduleService(db, {
          now,
          createId: sequentialIds("restart-entry"),
        }),
      }),
    });
  }

  it("repairs a gap on ready after downtime, keeping the anchor and seed", async () => {
    const first = await startServer();
    await send(first.server, "POST", GENERATE_URL, {});
    const before = await readState(first.db);
    await first.server.close();
    const later = T0 + 4 * DAY;

    const second = await restartServer(first.dataDirectory, () => later);
    await second.server.ready();

    const after = await readState(second.db);
    expect(after).toMatchObject({
      anchor_time: before.anchor_time,
      seed: before.seed,
      schedule_revision: before.schedule_revision + 1,
    });
    expect(after.last_generated_through).toBeGreaterThanOrEqual(
      later + SCHEDULE_HORIZON_MS,
    );
    const entries = await readScheduleEntries(second.db, CHANNEL_ID);
    expect(
      entries.some(
        (entry) => entry.starts_at <= later && entry.ends_at > later,
      ),
    ).toBe(true);
  });

  it("leaves the revision unchanged when coverage still reaches a full horizon", async () => {
    const first = await startServer();
    await send(first.server, "POST", GENERATE_URL, {});
    const before = await readState(first.db);
    await first.server.close();

    const second = await restartServer(first.dataDirectory, first.clock.now);
    await second.server.ready();

    expect(await readState(second.db)).toEqual(before);
  });
});
