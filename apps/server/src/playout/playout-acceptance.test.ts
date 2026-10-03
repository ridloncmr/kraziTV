// Spec 0005 acceptance: channel state and playout windows served over HTTP by
// the real composition and a real temporary SQLite file, driven through a
// channel's lifecycle on a manual clock, including a restart.
import type { FastifyInstance } from "fastify";
import { sql, type Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { iso, send, windowUrl } from "../testing/api-requests.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import { readScheduleEntries } from "../testing/schedule-fixtures.js";
import { startScheduleServer } from "../testing/schedule-server.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
} from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const T0 = FIXTURE_TIME;

// The whole public shapes. Anything more would leak packaging inputs such as
// `mediaPath` or `hasAudio`, or provider, FFmpeg, or URL concerns.
const ITEM_FIELDS = [
  "createdAt",
  "durationMs",
  "endsAt",
  "mediaItemId",
  "scheduleEntryId",
  "startOffsetMs",
  "startsAt",
  "title",
  "type",
  "updatedAt",
];
const CURRENT_ITEM_FIELDS = [...ITEM_FIELDS, "offsetMs"].sort();
const CURRENT_STATE_FIELDS = [
  "channelId",
  "currentItem",
  "evaluatedAt",
  "nextItem",
  "scheduleRevision",
];
const NO_CURRENT_STATE_FIELDS = [...CURRENT_STATE_FIELDS, "reason"].sort();
const TIMELINE_FIELDS = ["channelId", "items", "scheduleRevision"];

/** One playout item as the API returns it. */
interface ApiPlayoutItem {
  scheduleEntryId: string;
  mediaItemId: string;
  startsAt: string;
  endsAt: string;
  offsetMs?: number;
  [field: string]: unknown;
}

/** A `/now` response: channel state on success, an error envelope otherwise. */
interface ApiChannelState {
  scheduleRevision: number;
  evaluatedAt: string;
  currentItem: ApiPlayoutItem | null;
  nextItem: ApiPlayoutItem | null;
  reason?: string;
  scheduleEntryId?: string;
  error: { code: string };
}

/** A `/playout` response: a timeline on success, an error envelope otherwise. */
interface ApiTimeline {
  scheduleRevision: number;
  items: ApiPlayoutItem[];
  error: { code: string };
}

/** One schedule entry, reduced to the fields this test compares. */
interface ApiEntry {
  id: string;
  mediaItemId: string;
  startsAt: string;
  endsAt: string;
}

// Reads channel state at the server's clock, or at a pinned instant.
async function readNow(
  server: FastifyInstance,
  channelId: string,
  at?: number,
): Promise<{ status: number; body: ApiChannelState }> {
  const url = `/channels/${channelId}/now`;
  return send(server, "GET", at === undefined ? url : `${url}?at=${iso(at)}`);
}

// Reads the playout timeline for a window.
async function readPlayout(
  server: FastifyInstance,
  channelId: string,
  start: number,
  end: number,
): Promise<{ status: number; body: ApiTimeline }> {
  return send(
    server,
    "GET",
    windowUrl(`/channels/${channelId}/playout`, start, end),
  );
}

// Reads the guide entries overlapping a window.
async function readSchedule(
  server: FastifyInstance,
  channelId: string,
  start: number,
  end: number,
): Promise<ApiEntry[]> {
  const window = await send(
    server,
    "GET",
    windowUrl(`/channels/${channelId}/schedule`, start, end),
  );
  expect(window.status).toBe(200);
  return window.body.entries;
}

// Lists every table SQLite holds, as migrations created them.
async function tablesOf(db: Kysely<DatabaseSchema>) {
  const { rows } = await sql<{ name: string }>`
    select name from sqlite_master where type = 'table'
  `.execute(db);
  return rows.map(({ name }) => name);
}

// Asserts a playout item carries exactly the public item fields and that its
// instants are UTC and its duration an integer millisecond span.
function expectPublicItem(item: ApiPlayoutItem, fields: readonly string[]) {
  expect(Object.keys(item).sort()).toEqual(fields);
  expect(item.startsAt).toMatch(/Z$/);
  expect(item.endsAt).toMatch(/Z$/);
  expect(Number.isSafeInteger(item.durationMs)).toBe(true);
  expect(Date.parse(item.endsAt) - Date.parse(item.startsAt)).toBe(
    item.durationMs,
  );
}

describe("playout timeline acceptance", () => {
  it("serves channel state and playout windows through joins, boundaries, changes, and a restart", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const clock = manualClock(T0);
    const first = await startScheduleServer(dataDirectory, clock, "first", {
      seedCatalog: true,
    });

    // Configuration over HTTP: two collections and a chronological block.
    const office = await send(first.server, "POST", "/media-collections", {
      name: "The Office",
      mediaItemIds: ["pilot", "second", "finale"],
    });
    const movies = await send(first.server, "POST", "/media-collections", {
      name: "Movies",
      mediaItemIds: ["feature-a", "feature-b"],
    });
    const channel = await send(first.server, "POST", "/channels", {
      number: "69",
      name: "Krazi Main",
    });
    const channelId: string = channel.body.id;
    const blocksUrl = `/channels/${channelId}/programming-blocks`;
    const block = await send(first.server, "POST", blocksUrl, {
      source: {
        kind: "collection",
        mediaCollectionId: office.body.id,
        playbackMode: "chronological",
      },
    });
    expect([
      office.status,
      movies.status,
      channel.status,
      block.status,
    ]).toEqual([201, 201, 201, 201]);
    const blockUrl = `${blocksUrl}/${block.body.id}`;

    // A viewer joining mid-program gets the airing item, its offset from
    // wall-clock time, and the next item, all in the public shape.
    clock.advance(5 * MINUTE + 30 * SECOND);
    const joined = await readNow(first.server, channelId);
    expect(joined.status).toBe(200);
    expect(Object.keys(joined.body).sort()).toEqual(CURRENT_STATE_FIELDS);
    expect(joined.body.evaluatedAt).toBe(iso(clock.now()));
    const joinedItem = joined.body.currentItem as ApiPlayoutItem;
    expectPublicItem(joinedItem, CURRENT_ITEM_FIELDS);
    expect(joinedItem).toMatchObject({
      mediaItemId: "pilot",
      startsAt: iso(T0),
      offsetMs: 5 * MINUTE + 30 * SECOND,
    });
    expectPublicItem(joined.body.nextItem as ApiPlayoutItem, ITEM_FIELDS);
    expect(joined.body.nextItem?.mediaItemId).toBe("second");

    // The same instant, pinned, answers identically.
    expect((await readNow(first.server, channelId, clock.now())).body).toEqual(
      joined.body,
    );

    // Each playable guide entry becomes one playout item with its entry's
    // identity and times; no separate playout identity exists.
    const guide = await readSchedule(
      first.server,
      channelId,
      T0,
      T0 + 2 * HOUR,
    );
    const timeline = await readPlayout(
      first.server,
      channelId,
      T0,
      T0 + 2 * HOUR,
    );
    expect(timeline.status).toBe(200);
    expect(Object.keys(timeline.body).sort()).toEqual(TIMELINE_FIELDS);
    expect(timeline.body.scheduleRevision).toBe(joined.body.scheduleRevision);
    for (const playoutItem of timeline.body.items) {
      expectPublicItem(playoutItem, ITEM_FIELDS);
    }
    expect(
      timeline.body.items.map(
        ({ scheduleEntryId, mediaItemId, startsAt, endsAt }) => ({
          id: scheduleEntryId,
          mediaItemId,
          startsAt,
          endsAt,
        }),
      ),
    ).toEqual(
      guide.map(({ id, mediaItemId, startsAt, endsAt }) => ({
        id,
        mediaItemId,
        startsAt,
        endsAt,
      })),
    );

    // Crossing a boundary: the next item airs from offset zero onward.
    clock.advance(Date.parse(joinedItem.endsAt) + SECOND - clock.now());
    const crossed = await readNow(first.server, channelId);
    expect(crossed.body.currentItem).toMatchObject({
      scheduleEntryId: joined.body.nextItem?.scheduleEntryId,
      mediaItemId: "second",
      offsetMs: SECOND,
    });
    expect(crossed.body.nextItem?.mediaItemId).toBe("finale");

    // Regenerating mid-airing holds the airing item, increments the revision
    // once, and points the next item at the new successor.
    clock.advance(4 * MINUTE);
    const beforeChange = await readNow(first.server, channelId);
    const airing = beforeChange.body.currentItem as ApiPlayoutItem;
    const changed = await send(first.server, "PATCH", blockUrl, {
      source: {
        kind: "collection",
        mediaCollectionId: movies.body.id,
        playbackMode: "chronological",
      },
    });
    expect(changed.status).toBe(200);
    const afterChange = await readNow(first.server, channelId);
    expect(afterChange.body.currentItem).toEqual(airing);
    expect(afterChange.body.scheduleRevision).toBe(
      beforeChange.body.scheduleRevision + 1,
    );
    const successor = (
      await readSchedule(
        first.server,
        channelId,
        Date.parse(airing.endsAt),
        Date.parse(airing.endsAt) + HOUR,
      )
    )[0];
    expect(successor.startsAt).toBe(airing.endsAt);
    expect(successor.mediaItemId).toBe("feature-a");
    expect(afterChange.body.nextItem?.scheduleEntryId).toBe(successor.id);
    expect(successor.id).not.toBe(beforeChange.body.nextItem?.scheduleEntryId);

    // Media going missing is reported as unavailable, and the playout window
    // omits it, without changing the schedule or its revision.
    const entriesBeforeMissing = await readScheduleEntries(first.db, channelId);
    await first.db
      .updateTable("media_items")
      .set({ status: "missing" })
      .where("id", "=", "second")
      .execute();
    const unavailable = await readNow(first.server, channelId);
    expect(unavailable.status).toBe(200);
    expect(Object.keys(unavailable.body).sort()).toEqual(
      [...NO_CURRENT_STATE_FIELDS, "scheduleEntryId"].sort(),
    );
    expect(unavailable.body).toMatchObject({
      scheduleRevision: afterChange.body.scheduleRevision,
      currentItem: null,
      nextItem: null,
      reason: "media_unavailable",
      scheduleEntryId: airing.scheduleEntryId,
    });
    const withoutMissing = await readPlayout(
      first.server,
      channelId,
      clock.now(),
      clock.now() + HOUR,
    );
    expect(withoutMissing.body.items[0]).toMatchObject({
      scheduleEntryId: successor.id,
    });
    expect(await readScheduleEntries(first.db, channelId)).toEqual(
      entriesBeforeMissing,
    );
    await first.db
      .updateTable("media_items")
      .set({ status: "available" })
      .where("id", "=", "second")
      .execute();
    expect((await readNow(first.server, channelId)).body).toEqual(
      afterChange.body,
    );

    // A restart on the same data directory answers identically: channel
    // state is derived from persisted entries, never kept in memory.
    const windowStart = clock.now() - HOUR;
    const windowEnd = clock.now() + 3 * HOUR;
    const nowBeforeRestart = await readNow(first.server, channelId);
    const playoutBeforeRestart = await readPlayout(
      first.server,
      channelId,
      windowStart,
      windowEnd,
    );
    await first.server.close();
    const second = await startScheduleServer(dataDirectory, clock, "second");
    expect(await readNow(second.server, channelId)).toEqual(nowBeforeRestart);
    expect(
      await readPlayout(second.server, channelId, windowStart, windowEnd),
    ).toEqual(playoutBeforeRestart);

    // A disabled channel transmits nothing, so it has no channel state or
    // playout timeline; its guide stays readable.
    expect(
      (
        await send(second.server, "PATCH", `/channels/${channelId}`, {
          enabled: false,
        })
      ).status,
    ).toBe(200);
    const disabledNow = await readNow(second.server, channelId);
    const disabledPlayout = await readPlayout(
      second.server,
      channelId,
      windowStart,
      windowEnd,
    );
    expect([disabledNow.status, disabledPlayout.status]).toEqual([409, 409]);
    expect(disabledNow.body.error.code).toBe("channel_disabled");
    expect(disabledPlayout.body.error.code).toBe("channel_disabled");
    expect(
      (await readSchedule(second.server, channelId, windowStart, windowEnd))
        .length,
    ).toBeGreaterThan(0);
    expect(
      (
        await send(second.server, "PATCH", `/channels/${channelId}`, {
          enabled: true,
        })
      ).status,
    ).toBe(200);

    // Removing the block keeps the airing item on air, then leaves a
    // schedule gap: an empty transmission is a state, not an error.
    expect((await send(second.server, "DELETE", blockUrl)).status).toBe(204);
    const stillAiring = await readNow(second.server, channelId);
    expect(stillAiring.body.currentItem?.scheduleEntryId).toBe(
      airing.scheduleEntryId,
    );
    expect(stillAiring.body.nextItem).toBeNull();
    const afterAiring = Date.parse(airing.endsAt);
    clock.advance(afterAiring - clock.now());
    const gap = await readNow(second.server, channelId);
    expect(gap.status).toBe(200);
    expect(Object.keys(gap.body).sort()).toEqual(NO_CURRENT_STATE_FIELDS);
    expect(gap.body).toMatchObject({
      currentItem: null,
      nextItem: null,
      reason: "schedule_gap",
    });
    const emptyPlayout = await readPlayout(
      second.server,
      channelId,
      afterAiring,
      afterAiring + HOUR,
    );
    expect(emptyPlayout.status).toBe(200);
    expect(emptyPlayout.body.items).toEqual([]);

    // Playout items and channel state are derived on demand: no migration
    // adds a table to persist them.
    expect(
      (await tablesOf(second.db)).filter((table) =>
        /playout|channel_state/.test(table),
      ),
    ).toEqual([]);
  });
});
