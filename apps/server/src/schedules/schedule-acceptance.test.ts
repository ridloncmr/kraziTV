// Spec 0004 acceptance: programming configured over HTTP against the real
// composition and a real temporary SQLite file, driven through a channel's
// whole schedule lifecycle on a manual clock, including a restart.
import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import type { FastifyInstance } from "fastify";
import { sql, type Insertable, type Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import { send, iso } from "../testing/api-requests.js";
import {
  FIXTURE_TIME,
  itemFixtureAt,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import { manualClock, type ManualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import {
  readOnlyScheduleState,
  readScheduleEntries,
  seedScheduleScenario,
} from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  startTestServer,
} from "../testing/test-environment.js";
import { ScheduleService } from "./schedule-service.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = FIXTURE_TIME;

// The whole public entry shape and its stored columns. Anything more would
// leak provider, FFmpeg, packaging, or playout concerns into the guide.
const ENTRY_FIELDS = [
  "channelId",
  "createdAt",
  "durationMs",
  "endsAt",
  "id",
  "mediaCollectionId",
  "mediaItemId",
  "playbackIndex",
  "playbackMode",
  "programmingBlockId",
  "sequenceNumber",
  "startsAt",
  "title",
  "updatedAt",
];
const ENTRY_COLUMNS = [
  "channel_id",
  "created_at",
  "duration_ms",
  "ends_at",
  "id",
  "media_collection_id",
  "media_item_id",
  "playback_index",
  "playback_mode",
  "programming_block_id",
  "sequence_number",
  "starts_at",
  "title",
  "updated_at",
];
const STATE_COLUMNS = [
  "anchor_time",
  "channel_id",
  "created_at",
  "last_generated_through",
  "next_sequence_number",
  "schedule_revision",
  "seed",
  "updated_at",
];

/** One entry as the API returns it. */
interface ApiEntry {
  id: string;
  mediaItemId: string;
  startsAt: string;
  endsAt: string;
  durationMs: number;
  programmingBlockId: string | null;
  [field: string]: unknown;
}

/** A schedule window response: entries on success, an error envelope otherwise. */
interface ApiWindow {
  scheduleRevision: number;
  entries: ApiEntry[];
  error: { code: string; reason?: string };
}

// Builds a cataloged media item whose ID doubles as its unique path and title.
function item(id: string, minutes: number): Insertable<MediaItemTable> {
  return itemFixtureAt(id, `/media/movies/${id}.mkv`, {
    title: id,
    duration_ms: minutes * MINUTE,
  });
}

// Composes the server the way index.ts does, on the test's clock. Each boot
// gets its own ID prefix so entries from different boots never collide.
async function startServer(
  dataDirectory: string,
  clock: ManualClock,
  boot: string,
  options: { seedCatalog?: boolean } = {},
) {
  const { server, db } = await startTestServer({
    dataDirectory,
    seed: async (db) => {
      if (!options.seedCatalog) return;
      await db.insertInto("media_roots").values(rootFixture).execute();
      await db
        .insertInto("media_items")
        .values([
          item("pilot", 22),
          item("second", 23),
          item("finale", 24),
          item("feature-a", 90),
          item("feature-b", 100),
        ])
        .execute();
    },
    overrides: (db) => ({
      schedules: new ScheduleService(db, {
        now: clock.now,
        createId: sequentialIds(`${boot}-entry`),
      }),
    }),
  });
  await server.ready();
  return { server, db };
}

// Reads the entries overlapping a window, with the revision they belong to.
async function readWindow(
  server: FastifyInstance,
  channelId: string,
  start: number,
  end: number,
): Promise<{ status: number; body: ApiWindow }> {
  return send(
    server,
    "GET",
    `/channels/${channelId}/schedule?start=${iso(start)}&end=${iso(end)}`,
  );
}

// Lists a table's column names, sorted, as SQLite reports them.
async function columnsOf(db: Kysely<DatabaseSchema>, table: string) {
  const { rows } = await sql<{ name: string }>`
    select name from pragma_table_info(${table})
  `.execute(db);
  return rows.map(({ name }) => name).sort();
}

// Finds the entry covering an instant; the test fails if none does.
function airingAt(entries: readonly ApiEntry[], instant: number): ApiEntry {
  const airing = entries.find(
    (entry) =>
      Date.parse(entry.startsAt) <= instant &&
      Date.parse(entry.endsAt) > instant,
  );
  if (!airing) throw new Error(`No entry airs at ${iso(instant)}`);
  return airing;
}

// The entries starting at or after an instant, in order.
function startingFrom(entries: readonly ApiEntry[], instant: number) {
  return entries.filter((entry) => Date.parse(entry.startsAt) >= instant);
}

describe("schedule generation acceptance", () => {
  it("programs a channel and keeps its schedule through changes, lapses, and a restart", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const clock = manualClock(T0);
    const first = await startServer(dataDirectory, clock, "first", {
      seedCatalog: true,
    });

    // Configuration: two collections and a channel with no programming yet.
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
    expect([office.status, movies.status, channel.status]).toEqual([
      201, 201, 201,
    ]);
    const channelId: string = channel.body.id;
    const blocksUrl = `/channels/${channelId}/programming-blocks`;

    const unprogrammed = await readWindow(
      first.server,
      channelId,
      T0,
      T0 + HOUR,
    );
    expect(unprogrammed.status).toBe(409);
    expect(unprogrammed.body.error).toMatchObject({
      code: "channel_unschedulable",
      reason: "no_programming_block",
    });

    // One chronological block; a second block is rejected.
    const block = await send(first.server, "POST", blocksUrl, {
      source: {
        kind: "collection",
        mediaCollectionId: office.body.id,
        playbackMode: "chronological",
      },
    });
    expect(block.status).toBe(201);
    const blockUrl = `${blocksUrl}/${block.body.id}`;
    expect(
      (
        await send(first.server, "POST", blocksUrl, {
          source: { kind: "media_item", mediaItemId: "pilot" },
        })
      ).status,
    ).toBe(409);

    // Materialized entries follow collection order, back to back, in
    // integer milliseconds, with at least a full horizon persisted.
    const opening = await readWindow(
      first.server,
      channelId,
      T0,
      T0 + 3 * HOUR,
    );
    expect(opening.status).toBe(200);
    const openingEntries: ApiEntry[] = opening.body.entries;
    expect(
      openingEntries.slice(0, 4).map((entry) => entry.mediaItemId),
    ).toEqual(["pilot", "second", "finale", "pilot"]);
    expect(Date.parse(openingEntries[0].startsAt)).toBe(T0);
    for (const [index, entry] of openingEntries.entries()) {
      expect(Object.keys(entry).sort()).toEqual(ENTRY_FIELDS);
      expect(Number.isSafeInteger(entry.durationMs)).toBe(true);
      expect(Date.parse(entry.endsAt) - Date.parse(entry.startsAt)).toBe(
        entry.durationMs,
      );
      if (index > 0) {
        expect(entry.startsAt).toBe(openingEntries[index - 1].endsAt);
      }
    }
    const opened = await readOnlyScheduleState(first.db);
    expect(opened.anchor_time).toBe(T0);
    expect(opened.last_generated_through).toBeGreaterThanOrEqual(
      T0 + SCHEDULE_HORIZON_MS,
    );

    // Overlapping reads agree on the entries they share, and a covered
    // read is a no-op that leaves the revision alone.
    const overlapping = await readWindow(
      first.server,
      channelId,
      T0 + HOUR,
      T0 + 4 * HOUR,
    );
    const sharedIds = new Set(
      overlapping.body.entries.map((entry: ApiEntry) => entry.id),
    );
    const shared = openingEntries.filter((entry) => sharedIds.has(entry.id));
    expect(shared.length).toBeGreaterThan(0);
    expect(overlapping.body.entries.slice(0, shared.length)).toEqual(shared);
    expect(overlapping.body.scheduleRevision).toBe(
      opening.body.scheduleRevision,
    );

    // Two days later the horizon extends without touching earlier entries.
    clock.advance(2 * DAY);
    const extended = await readWindow(
      first.server,
      channelId,
      T0,
      T0 + 3 * HOUR,
    );
    expect(extended.body.entries).toEqual(openingEntries);
    expect(extended.body.scheduleRevision).toBeGreaterThan(
      opening.body.scheduleRevision,
    );
    expect(
      (await readOnlyScheduleState(first.db)).last_generated_through,
    ).toBeGreaterThanOrEqual(clock.now() + SCHEDULE_HORIZON_MS);

    // A block change mid-program keeps the airing entry and regenerates from
    // its end with the new source.
    clock.advance(10 * MINUTE);
    const midAiring = clock.now();
    const beforeChange = await readWindow(
      first.server,
      channelId,
      midAiring - HOUR,
      midAiring + 6 * HOUR,
    );
    const airing = airingAt(beforeChange.body.entries, midAiring);
    const changed = await send(first.server, "PATCH", blockUrl, {
      source: {
        kind: "collection",
        mediaCollectionId: movies.body.id,
        playbackMode: "chronological",
      },
    });
    expect(changed.status).toBe(200);
    const afterChange = await readWindow(
      first.server,
      channelId,
      midAiring - HOUR,
      midAiring + 6 * HOUR,
    );
    expect(airingAt(afterChange.body.entries, midAiring)).toEqual(airing);
    expect(
      startingFrom(afterChange.body.entries, Date.parse(airing.endsAt))
        .slice(0, 3)
        .map((entry) => entry.mediaItemId),
    ).toEqual(["feature-a", "feature-b", "feature-a"]);
    expect(afterChange.body.scheduleRevision).toBeGreaterThan(
      beforeChange.body.scheduleRevision,
    );

    // A membership change regenerates from the same boundary, restarting the
    // replaced order where the deleted entries had picked up.
    expect(
      (
        await send(
          first.server,
          "PUT",
          `/media-collections/${movies.body.id}/items`,
          { mediaItemIds: ["feature-b", "feature-a"] },
        )
      ).status,
    ).toBe(200);
    const afterMembership = await readWindow(
      first.server,
      channelId,
      midAiring - HOUR,
      midAiring + 6 * HOUR,
    );
    expect(airingAt(afterMembership.body.entries, midAiring)).toEqual(airing);
    expect(
      startingFrom(afterMembership.body.entries, Date.parse(airing.endsAt))
        .slice(0, 3)
        .map((entry) => entry.mediaItemId),
    ).toEqual(["feature-b", "feature-a", "feature-b"]);

    // The block's collection cannot be deleted while it is referenced.
    const inUse = await send(
      first.server,
      "DELETE",
      `/media-collections/${movies.body.id}`,
    );
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe("media_collection_in_use");

    // Disabled, the channel still serves what it has but generates nothing.
    expect(
      (
        await send(first.server, "PATCH", `/channels/${channelId}`, {
          enabled: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (await readWindow(first.server, channelId, midAiring, midAiring + HOUR))
        .status,
    ).toBe(200);
    const disabledGenerate = await send(
      first.server,
      "POST",
      `/channels/${channelId}/schedule/generate`,
      {},
    );
    expect(disabledGenerate.status).toBe(409);
    expect(disabledGenerate.body.error.code).toBe("channel_disabled");

    // After the schedule lapses, re-enabling keeps the anchor and seed and
    // repairs from now, leaving the uncovered interval empty.
    const lapsed = await readOnlyScheduleState(first.db);
    clock.advance(8 * DAY);
    const reenabledAt = clock.now();
    expect(lapsed.last_generated_through).toBeLessThan(reenabledAt);
    const lastKept = (
      await readWindow(
        first.server,
        channelId,
        lapsed.last_generated_through - HOUR,
        lapsed.last_generated_through,
      )
    ).body.entries.at(-1) as ApiEntry;
    expect(
      (
        await send(first.server, "PATCH", `/channels/${channelId}`, {
          enabled: true,
        })
      ).status,
    ).toBe(200);
    const repaired = await readOnlyScheduleState(first.db);
    expect(repaired).toMatchObject({
      anchor_time: lapsed.anchor_time,
      seed: lapsed.seed,
    });
    expect(repaired.last_generated_through).toBeGreaterThanOrEqual(
      reenabledAt + SCHEDULE_HORIZON_MS,
    );
    const gap = await readWindow(
      first.server,
      channelId,
      lapsed.last_generated_through,
      reenabledAt,
    );
    expect(gap.status).toBe(200);
    expect(gap.body.entries).toEqual([]);
    const afterRepair = await readWindow(
      first.server,
      channelId,
      reenabledAt,
      reenabledAt + 6 * HOUR,
    );
    const resumed: ApiEntry = afterRepair.body.entries[0];
    expect(Date.parse(resumed.startsAt)).toBe(reenabledAt);
    // Progress continues from the last kept entry; the gap consumed none.
    const replacedOrder = ["feature-b", "feature-a"];
    expect(resumed.mediaItemId).toBe(
      replacedOrder[(replacedOrder.indexOf(lastKept.mediaItemId) + 1) % 2],
    );

    // A restart on the same data directory serves the same schedule and
    // changes nothing while coverage still reaches a full horizon.
    const beforeRestart = await readOnlyScheduleState(first.db);
    await first.server.close();
    const second = await startServer(dataDirectory, clock, "second");
    expect(await readOnlyScheduleState(second.db)).toEqual(beforeRestart);
    expect(
      (
        await readWindow(
          second.server,
          channelId,
          reenabledAt,
          reenabledAt + 6 * HOUR,
        )
      ).body,
    ).toEqual(afterRepair.body);

    // Deleting the block keeps the airing entry as history, drops the
    // future, and frees its collection for deletion.
    expect((await send(second.server, "DELETE", blockUrl)).status).toBe(204);
    const afterDelete = await readWindow(
      second.server,
      channelId,
      reenabledAt,
      reenabledAt + 6 * HOUR,
    );
    expect(afterDelete.status).toBe(200);
    expect(afterDelete.body.entries).toEqual([
      expect.objectContaining({
        id: resumed.id,
        programmingBlockId: null,
      }),
    ]);
    const unprogrammedAgain = await readWindow(
      second.server,
      channelId,
      Date.parse(resumed.endsAt),
      Date.parse(resumed.endsAt) + HOUR,
    );
    expect(unprogrammedAgain.status).toBe(409);
    expect(unprogrammedAgain.body.error.reason).toBe("no_programming_block");
    expect(
      (
        await send(
          second.server,
          "DELETE",
          `/media-collections/${movies.body.id}`,
        )
      ).status,
    ).toBe(204);
    expect(
      (await readScheduleEntries(second.db, channelId)).find(
        (entry) => entry.id === resumed.id,
      ),
    ).toMatchObject({ media_collection_id: null, programming_block_id: null });

    // Provider-neutral storage: no provider, FFmpeg, segment, or URL columns.
    expect(await columnsOf(second.db, "schedule_entries")).toEqual(
      ENTRY_COLUMNS,
    );
    expect(await columnsOf(second.db, "channel_schedule_states")).toEqual(
      STATE_COLUMNS,
    );
  });

  it("produces identical entries from identical inputs", async () => {
    // Random playback is the mode most likely to drift, so it proves the most.
    async function generate() {
      const clock = manualClock(T0);
      const { server, db } = await startServer(
        await createTemporaryDirectory(),
        clock,
        "run",
      );
      const { channelId } = await seedScheduleScenario(db, {
        items: [22, 23, 24, 25, 26].map((minutes) => ({
          durationMs: minutes * MINUTE,
        })),
        source: "random",
      });
      const generated = await send(
        server,
        "POST",
        `/channels/${channelId}/schedule/generate`,
        {},
      );
      expect(generated.status).toBe(200);
      return readScheduleEntries(db, channelId);
    }

    const firstRun = await generate();
    const secondRun = await generate();

    expect(firstRun.length).toBeGreaterThan(0);
    expect(secondRun).toEqual(firstRun);
  });
});
