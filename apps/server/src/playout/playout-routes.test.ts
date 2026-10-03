import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import { afterEach, describe, expect, it } from "vitest";

import { iso, send, windowUrl } from "../testing/api-requests.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { holdWriteAuthority } from "../testing/hold-write-authority.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import {
  readOnlyScheduleState,
  readScheduleEntries,
  seedScheduleScenario,
  type ScheduleScenarioOptions,
} from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
  startTestServer,
} from "../testing/test-environment.js";
import { SCHEDULE_REQUEST_LIMIT_MS } from "../schedules/schedule-coverage.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { unwrittenCoverage } from "../testing/unwritten-coverage.js";
import { PlayoutService } from "./playout-service.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = FIXTURE_TIME;
// Eight minutes into the second episode of a schedule anchored at T0.
const MID_SECOND = T0 + 30 * MINUTE;
const EPISODES = [22, 23, 24].map((minutes) => ({
  durationMs: minutes * MINUTE,
}));
// The channel seedScheduleScenario writes.
const CHANNEL_ID = "channel-fixture-001";
const NOW_URL = `/channels/${CHANNEL_ID}/now`;
const PLAYOUT_URL = `/channels/${CHANNEL_ID}/playout`;

// Boots the real composition over three chronological episodes on a manual
// clock, with startup coverage anchored at T0. Only `schedules` is
// overridden, so the default playout service must pick up its clock.
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
  await server.ready();
  return { server, db, clock, dataDirectory };
}

// Boots a server whose playout coverage writes never land, then moves a day
// past startup coverage, so every playout read finds coverage still short
// after its one retry.
async function startServerWithUnwrittenCoverage() {
  const clock = manualClock(T0);
  const { server } = await startTestServer({
    seed: async (db) => {
      await seedScheduleScenario(db, {
        items: EPISODES,
        source: "chronological",
      });
    },
    overrides: (db) => ({
      schedules: new ScheduleService(db, { now: clock.now }),
      playout: new PlayoutService(db, unwrittenCoverage(clock.now)),
    }),
  });
  await server.ready();
  clock.advance(DAY);
  return server;
}

describe("GET /channels/:id/now", () => {
  it("returns the current item with its join offset and the next item", async () => {
    const { server, db, clock } = await startServer();
    clock.set(MID_SECOND);

    const { status, body } = await send(server, "GET", NOW_URL);

    const { schedule_revision } = await readOnlyScheduleState(db);
    expect(status).toBe(200);
    expect(body).toEqual({
      channelId: CHANNEL_ID,
      scheduleRevision: schedule_revision,
      evaluatedAt: iso(MID_SECOND),
      currentItem: {
        type: "program",
        scheduleEntryId: "entry-002",
        mediaItemId: "item-002",
        title: "Item 2",
        startsAt: iso(T0 + 22 * MINUTE),
        endsAt: iso(T0 + 45 * MINUTE),
        durationMs: 23 * MINUTE,
        startOffsetMs: 0,
        offsetMs: 8 * MINUTE,
        createdAt: iso(T0),
        updatedAt: iso(T0),
      },
      nextItem: {
        type: "program",
        scheduleEntryId: "entry-003",
        mediaItemId: "item-003",
        title: "Item 3",
        startsAt: iso(T0 + 45 * MINUTE),
        endsAt: iso(T0 + 69 * MINUTE),
        durationMs: 24 * MINUTE,
        startOffsetMs: 0,
        createdAt: iso(T0),
        updatedAt: iso(T0),
      },
    });
  });

  it("evaluates a given instant deterministically", async () => {
    const { server, clock } = await startServer();
    const url = `${NOW_URL}?at=${iso(MID_SECOND)}`;

    const first = await send(server, "GET", url);
    clock.advance(5 * MINUTE);
    const second = await send(server, "GET", url);

    expect(first.status).toBe(200);
    expect(first.body.evaluatedAt).toBe(iso(MID_SECOND));
    expect(first.body.currentItem.offsetMs).toBe(8 * MINUTE);
    // The moved clock slides the horizon, so only the revision may differ.
    expect(second.body).toEqual({
      ...first.body,
      scheduleRevision: expect.any(Number),
    });
  });

  it("extends coverage for a channel short of its horizon, then answers at the new revision", async () => {
    const { server, db, clock } = await startServer();
    clock.advance(DAY);

    const { status, body } = await send(server, "GET", NOW_URL);

    const state = await readOnlyScheduleState(db);
    expect(status).toBe(200);
    expect(state.schedule_revision).toBe(2);
    expect(state.last_generated_through).toBeGreaterThanOrEqual(
      T0 + DAY + SCHEDULE_HORIZON_MS,
    );
    expect(body.scheduleRevision).toBe(2);
    expect(body.evaluatedAt).toBe(iso(T0 + DAY));
  });

  it("reports a schedule gap at revision 0 for an unschedulable channel with no entries", async () => {
    const { server } = await startServer({ source: null });

    await expect(send(server, "GET", NOW_URL)).resolves.toEqual({
      status: 200,
      body: {
        channelId: CHANNEL_ID,
        scheduleRevision: 0,
        evaluatedAt: iso(T0),
        currentItem: null,
        nextItem: null,
        reason: "schedule_gap",
      },
    });
  });

  it("still returns the airing item once the channel becomes unschedulable", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "GET", NOW_URL);
    await db.deleteFrom("programming_blocks").execute();
    clock.set(MID_SECOND);

    const { status, body } = await send(server, "GET", NOW_URL);

    expect(status).toBe(200);
    expect(body.currentItem.scheduleEntryId).toBe("entry-002");
  });

  it("reports unavailable media with its entry and leaves the schedule untouched", async () => {
    const { server, db } = await startServer();
    await send(server, "GET", NOW_URL);
    await db
      .updateTable("media_items")
      .set({ status: "missing" })
      .where("id", "=", "item-002")
      .execute();
    const before = await readScheduleEntries(db, CHANNEL_ID);

    const { status, body } = await send(
      server,
      "GET",
      `${NOW_URL}?at=${iso(MID_SECOND)}`,
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      channelId: CHANNEL_ID,
      scheduleRevision: 1,
      evaluatedAt: iso(MID_SECOND),
      currentItem: null,
      nextItem: null,
      reason: "media_unavailable",
      scheduleEntryId: "entry-002",
    });
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(before);
  });

  it("rejects a disabled channel", async () => {
    const { server } = await startServer({ enabled: false });

    const { status, body } = await send(server, "GET", NOW_URL);

    expect(status).toBe(409);
    expect(body.error.code).toBe("channel_disabled");
  });

  it("reports an unknown channel", async () => {
    const { server } = await startServer();

    const { status, body } = await send(server, "GET", "/channels/missing/now");

    expect(status).toBe(404);
    expect(body.error.code).toBe("channel_not_found");
  });

  it.each([
    ["an instant with an offset", "2024-01-01T02:00:00%2B02:00"],
    ["an instant without a zone", "2024-01-01T00:00:00"],
    ["a non-instant", "soon"],
  ])("rejects %s", async (_, at) => {
    const { server } = await startServer();

    const { status, body } = await send(server, "GET", `${NOW_URL}?at=${at}`);

    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  it("rejects an instant past the request limit without generating", async () => {
    const { server, db } = await startServer();
    const before = await readScheduleEntries(db, CHANNEL_ID);

    const { status, body } = await send(
      server,
      "GET",
      `${NOW_URL}?at=${iso(T0 + SCHEDULE_REQUEST_LIMIT_MS + 1)}`,
    );

    expect(status).toBe(400);
    expect(body.error).toMatchObject({
      code: "invalid_request",
      message: `at must not be after ${iso(T0 + SCHEDULE_REQUEST_LIMIT_MS)}`,
    });
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(before);
  });

  it("answers 503 retryable when coverage is still short after the retry", async () => {
    const server = await startServerWithUnwrittenCoverage();

    const { status, body } = await send(server, "GET", NOW_URL);

    expect(status).toBe(503);
    expect(body.error).toMatchObject({
      code: "schedule_busy",
      retryable: true,
    });
  });

  it("answers 503 retryable when coverage needs a busy writer, and 200 when already covered", async () => {
    const { server, clock, dataDirectory } = await startServer();
    const covered = `${NOW_URL}?at=${iso(MID_SECOND)}`;
    await send(server, "GET", covered);
    const other = await openTestDatabase(dataDirectory);
    const holder = await holdWriteAuthority(other.db);
    try {
      const read = await send(server, "GET", covered);
      // A day later the horizon falls short, so answering needs a write.
      clock.advance(DAY);
      const short = await send(server, "GET", NOW_URL);

      expect(read.status).toBe(200);
      expect(short.status).toBe(503);
      expect(short.body.error).toMatchObject({
        code: "schedule_busy",
        retryable: true,
      });
    } finally {
      await holder.release();
    }
  });
});

describe("GET /channels/:id/playout", () => {
  it("returns the playable items overlapping the window in the public shape", async () => {
    const { server, db } = await startServer();

    const { status, body } = await send(
      server,
      "GET",
      windowUrl(PLAYOUT_URL, T0 + 10 * MINUTE, T0 + 30 * MINUTE),
    );

    const { schedule_revision } = await readOnlyScheduleState(db);
    expect(status).toBe(200);
    expect(body).toEqual({
      channelId: CHANNEL_ID,
      scheduleRevision: schedule_revision,
      items: [
        {
          type: "program",
          scheduleEntryId: "entry-001",
          mediaItemId: "item-001",
          title: "Item 1",
          startsAt: iso(T0),
          endsAt: iso(T0 + 22 * MINUTE),
          durationMs: 22 * MINUTE,
          startOffsetMs: 0,
          createdAt: iso(T0),
          updatedAt: iso(T0),
        },
        {
          type: "program",
          scheduleEntryId: "entry-002",
          mediaItemId: "item-002",
          title: "Item 2",
          startsAt: iso(T0 + 22 * MINUTE),
          endsAt: iso(T0 + 45 * MINUTE),
          durationMs: 23 * MINUTE,
          startOffsetMs: 0,
          createdAt: iso(T0),
          updatedAt: iso(T0),
        },
      ],
    });
  });

  it("returns identical items where two windows overlap", async () => {
    const { server } = await startServer();
    const read = async (start: number, end: number) =>
      (
        await send(server, "GET", windowUrl(PLAYOUT_URL, start, end))
      ).body.items.filter(
        (item: { startsAt: string; endsAt: string }) =>
          item.startsAt < iso(T0 + 18 * HOUR) &&
          item.endsAt > iso(T0 + 15 * HOUR),
      );

    const early = await read(T0 + 12 * HOUR, T0 + 18 * HOUR);
    const late = await read(T0 + 15 * HOUR, T0 + 21 * HOUR);

    expect(early.length).toBeGreaterThan(0);
    expect(early).toEqual(late);
  });

  it("omits an unplayable entry that the same window's schedule still lists", async () => {
    const { server, db } = await startServer();
    await db
      .updateTable("media_items")
      .set({ status: "missing" })
      .where("id", "=", "item-002")
      .execute();
    const end = T0 + 69 * MINUTE;

    const playout = await send(server, "GET", windowUrl(PLAYOUT_URL, T0, end));
    const schedule = await send(
      server,
      "GET",
      windowUrl(`/channels/${CHANNEL_ID}/schedule`, T0, end),
    );

    expect(playout.status).toBe(200);
    expect(
      playout.body.items.map(
        (item: { scheduleEntryId: string }) => item.scheduleEntryId,
      ),
    ).toEqual(["entry-001", "entry-003"]);
    expect(
      schedule.body.entries.map((entry: { id: string }) => entry.id),
    ).toEqual(["entry-001", "entry-002", "entry-003"]);
  });

  it("returns 200 with no items for an unschedulable channel with no entries", async () => {
    const { server } = await startServer({ source: null });

    await expect(
      send(server, "GET", windowUrl(PLAYOUT_URL, T0, T0 + HOUR)),
    ).resolves.toEqual({
      status: 200,
      body: { channelId: CHANNEL_ID, scheduleRevision: 0, items: [] },
    });
  });

  it("rejects a disabled channel", async () => {
    const { server } = await startServer({ enabled: false });

    const { status, body } = await send(
      server,
      "GET",
      windowUrl(PLAYOUT_URL, T0, T0 + HOUR),
    );

    expect(status).toBe(409);
    expect(body.error.code).toBe("channel_disabled");
  });

  it("reports an unknown channel", async () => {
    const { server } = await startServer();

    const { status, body } = await send(
      server,
      "GET",
      windowUrl("/channels/missing/playout", T0, T0 + HOUR),
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe("channel_not_found");
  });

  it.each([
    ["a reversed window", windowUrl(PLAYOUT_URL, T0 + HOUR, T0)],
    ["an empty window", windowUrl(PLAYOUT_URL, T0, T0)],
    [
      "a window longer than 7 days",
      windowUrl(PLAYOUT_URL, T0, T0 + SCHEDULE_REQUEST_LIMIT_MS + 1),
    ],
    [
      "an instant with an offset",
      `${PLAYOUT_URL}?start=2024-01-01T02:00:00%2B02:00&end=${iso(T0 + HOUR)}`,
    ],
    [
      "an instant without a zone",
      `${PLAYOUT_URL}?start=2024-01-01T00:00:00&end=${iso(T0 + HOUR)}`,
    ],
    ["a missing end", `${PLAYOUT_URL}?start=${iso(T0)}`],
  ])("rejects %s", async (_, url) => {
    const { server, db } = await startServer();
    const before = await readScheduleEntries(db, CHANNEL_ID);

    const { status, body } = await send(server, "GET", url);

    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(before);
  });

  it("covers a 7-day window through its end, past the horizon", async () => {
    const { server } = await startServer();
    const end = T0 + SCHEDULE_REQUEST_LIMIT_MS;

    const { status, body } = await send(
      server,
      "GET",
      windowUrl(PLAYOUT_URL, T0, end),
    );

    expect(status).toBe(200);
    expect(body.items.at(-1).endsAt >= iso(end)).toBe(true);
  });

  it("rejects a window ending past the request limit without generating", async () => {
    const { server, db } = await startServer();
    const end = T0 + SCHEDULE_REQUEST_LIMIT_MS + 1;
    const before = await readScheduleEntries(db, CHANNEL_ID);

    const { status, body } = await send(
      server,
      "GET",
      windowUrl(PLAYOUT_URL, end - HOUR, end),
    );

    expect(status).toBe(400);
    expect(body.error).toMatchObject({
      code: "invalid_request",
      message: `end must not be after ${iso(T0 + SCHEDULE_REQUEST_LIMIT_MS)}`,
    });
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(before);
  });

  it("answers 503 retryable when coverage is still short after the retry", async () => {
    const server = await startServerWithUnwrittenCoverage();

    const { status, body } = await send(
      server,
      "GET",
      windowUrl(PLAYOUT_URL, T0 + DAY, T0 + DAY + HOUR),
    );

    expect(status).toBe(503);
    expect(body.error).toMatchObject({
      code: "schedule_busy",
      retryable: true,
    });
  });
});
