import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import { afterEach, describe, expect, it } from "vitest";

import { iso, send } from "../testing/api-requests.js";
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
const DAY = 24 * 60 * MINUTE;
const T0 = FIXTURE_TIME;
// Eight minutes into the second episode of a schedule anchored at T0.
const MID_SECOND = T0 + 30 * MINUTE;
const EPISODES = [22, 23, 24].map((minutes) => ({
  durationMs: minutes * MINUTE,
}));
// The channel seedScheduleScenario writes.
const CHANNEL_ID = "channel-fixture-001";
const NOW_URL = `/channels/${CHANNEL_ID}/now`;

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
    // A day past startup coverage, so answering needs a write that never lands.
    clock.advance(DAY);

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
