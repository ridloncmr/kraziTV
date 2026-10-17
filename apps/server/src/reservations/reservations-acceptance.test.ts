// Programming spec 0006 acceptance, with the spec 0004 and 0005 criteria
// that waited on reservations: a reserved movie configured through the API
// beside default programming and rules, read back through schedule, playout,
// guide, and transition reads, across a restart and chunked coverage. The
// one transmission-timing criterion is measured with real FFmpeg in
// integration/channel-stream-ffmpeg.test.ts ("real FFmpeg reserved start").
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteTransitionCoordinator } from "../channels/runtime/sqlite-transition-coordinator.js";
import { iso, send, windowUrl } from "../testing/api-requests.js";
import { collectionAssignment } from "../testing/assignment-bodies.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { assignmentFixture } from "../testing/channel-fixtures.js";
import { insertMovie, reserveItems } from "../testing/reservation-fixtures.js";
import {
  readOnlyScheduleState,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import {
  startScheduleScenarioServer,
  startScheduleServer,
} from "../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";
import {
  readGuideProgrammes,
  xmltvTimestamp,
} from "../testing/xmltv-programmes.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
const at = (minutes: number) => T0 + minutes * MINUTE;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = "channel-fixture-001";
const SCHEDULE = `/channels/${CHANNEL_ID}/schedule`;
// 01:00 UTC on 2024-01-01 is 7:00 PM the evening before in Chicago.
const TIME_ZONE = "America/Chicago";

// The episode scenario with a 90-minute movie reserved at 60: episodes
// 0-22 and 22-45, filler 45-60 because the third would end at 69, the movie
// 60-150, and the third episode after it.
async function reservedMovie(
  options: { entriesPerTransaction?: number; endsAt?: number } = {},
) {
  const context = await startScheduleScenarioServer(
    {},
    {
      programmingTimezone: TIME_ZONE,
      entriesPerTransaction: options.entriesPerTransaction,
    },
  );
  const movie = await insertMovie(context.db);
  const reservation = await reserveItems(
    context.server,
    at(60),
    [movie],
    options.endsAt,
  );
  return { ...context, movie, reservation };
}

// What the schedule window between `from` and `to` lists: programs by item
// and start, and planned filler apart from them.
async function windowShape(server: FastifyInstance, from: number, to: number) {
  const { body } = await send(server, "GET", windowUrl(SCHEDULE, from, to));
  return {
    programs: (body.entries as { mediaItemId: string; startsAt: string }[]).map(
      ({ mediaItemId, startsAt }) => `${mediaItemId}@${startsAt}`,
    ),
    filler: (
      body.fillerIntervals as { startsAt: string; endsAt: string }[]
    ).map(({ startsAt, endsAt }) => `${startsAt}/${endsAt}`),
  };
}

// The channel's state at `minutes` through the now route.
async function nowAt(server: FastifyInstance, minutes: number) {
  return (
    await send(
      server,
      "GET",
      `/channels/${CHANNEL_ID}/now?at=${iso(at(minutes))}`,
    )
  ).body as Record<string, unknown>;
}

describe("spec 0006 acceptance", () => {
  it("starts a reserved movie exactly at its time without truncating the program before it", async () => {
    const { server, movie } = await reservedMovie();

    const { programs } = await windowShape(server, T0, at(160));

    // The second episode keeps its whole 23 minutes and the movie starts at 60.
    expect(programs).toEqual([
      `item-001@${iso(at(0))}`,
      `item-002@${iso(at(22))}`,
      `${movie}@${iso(at(60))}`,
      `item-003@${iso(at(150))}`,
    ]);
  });

  it("defers a program that cannot fit without consuming its collection progress", async () => {
    const { db } = await reservedMovie();

    // item-003 would have aired at 45; it airs right after the movie, so
    // the collection resumes exactly where it left off.
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    expect(entries.find((entry) => entry.starts_at === at(150))).toMatchObject({
      media_item_id: "item-003",
      playback_index: 2,
    });
  });

  it("produces no filler when a program ends exactly at the reservation", async () => {
    const context = await startScheduleScenarioServer();
    const movie = await insertMovie(context.db);
    await reserveItems(context.server, at(45), [movie]);

    const { filler, programs } = await windowShape(context.server, T0, at(140));

    expect(programs).toContain(`${movie}@${iso(at(45))}`);
    expect(filler).toEqual([]);
  });

  it("covers every required remainder with continuous transmission", async () => {
    const { server } = await reservedMovie({ endsAt: at(170) });

    const { body } = await send(
      server,
      "GET",
      windowUrl(`/channels/${CHANNEL_ID}/playout`, T0, at(200)),
    );

    const items = body.items as {
      type: string;
      startsAt: string;
      endsAt: string;
    }[];
    expect(items.map(({ type }) => type)).toEqual([
      "program",
      "program",
      "filler",
      "program",
      "filler",
      "program",
      "program",
    ]);
    // Back to back: every item starts exactly where the previous one ends.
    for (let index = 1; index < items.length; index += 1) {
      expect(items[index]?.startsAt).toBe(items[index - 1]?.endsAt);
    }
  });

  it("transmits filler worded in the programming timezone, needing no clip or cataloged media", async () => {
    const { server } = await reservedMovie();

    // The black screen itself is proven by integration/filler.test.ts.
    expect((await nowAt(server, 50)).currentItem).toMatchObject({
      type: "filler",
      resumeTime: "7:00 PM",
    });
  });

  it("supports explicit and program-derived ends, filling unused explicit time", async () => {
    const derived = await reservedMovie();
    expect(
      (
        await send(
          derived.server,
          "GET",
          `/channels/${CHANNEL_ID}/reservations`,
        )
      ).body,
    ).toMatchObject([{ endKind: "program_derived", endsAt: iso(at(150)) }]);
    await cleanUpTestEnvironment();

    const explicit = await reservedMovie({ endsAt: at(170) });

    expect(
      (await windowShape(explicit.server, at(140), at(180))).filler,
    ).toEqual([`${iso(at(150))}/${iso(at(170))}`]);
  });

  it("shows planned filler as Off air intervals, never as a schedule entry or XMLTV programme", async () => {
    const { server } = await reservedMovie();

    const shape = await windowShape(server, at(30), at(70));
    const guide = readGuideProgrammes(
      (await server.inject("/plex/xmltv.xml")).body,
    );

    expect(shape.filler).toEqual([`${iso(at(45))}/${iso(at(60))}`]);
    expect(shape.programs).toHaveLength(2);
    expect(guide.map(({ start }) => start)).not.toContain(
      xmltvTimestamp(at(45)),
    );
    expect(guide.slice(0, 3).map(({ start }) => start)).toEqual(
      [0, 22, 60].map((minutes) => xmltvTimestamp(at(minutes))),
    );
  });

  it("joins a viewer tuning during filler at its offset, with the reserved program next", async () => {
    const { server, movie } = await reservedMovie();

    expect(await nowAt(server, 50)).toMatchObject({
      currentItem: {
        type: "filler",
        startsAt: iso(at(45)),
        endsAt: iso(at(60)),
        offsetMs: 5 * MINUTE,
      },
      nextItem: { type: "program", mediaItemId: movie },
    });
  });

  it("never reports planned filler as a schedule gap or repairs it", async () => {
    const { server, db, clock } = await reservedMovie();
    clock.set(at(50));
    const before = await readScheduleEntries(db, CHANNEL_ID);

    const now = await nowAt(server, 50);

    expect(now.reason).toBeUndefined();
    expect(now.currentItem).toMatchObject({ type: "filler" });
    // Gap repair would regenerate from now; extending the horizon only
    // appends, so every entry from before the read stands unchanged.
    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("gives concurrent coverage requests the same filler identity", async () => {
    const { server } = await reservedMovie();

    const shapes = await Promise.all(
      Array.from({ length: 5 }, () => windowShape(server, T0, at(200))),
    );

    for (const shape of shapes) expect(shape).toEqual(shapes[0]);
    expect(shapes[0]?.filler).toEqual([`${iso(at(45))}/${iso(at(60))}`]);
  });

  it("invalidates a stale filler preparation while preserving what airs", async () => {
    const { server, db, clock } = await reservedMovie();
    clock.set(at(50));
    const prepared = {
      channelId: CHANNEL_ID,
      cursor: { kind: "filler" as const, endsAt: at(60) },
      scheduleRevision: (await readOnlyScheduleState(db)).schedule_revision,
    };

    await send(
      server,
      "PATCH",
      `/channels/${CHANNEL_ID}/programming-assignments/${assignmentFixture.id}`,
      collectionAssignment("collection-fixture-001", "random"),
    );

    await expect(
      new SqliteTransitionCoordinator(db, clock.now, {
        writeAuthorityWaitMs: 1_000,
      }).commitPreparedTransition(prepared, () => undefined),
    ).resolves.toBe("stale");
    expect((await nowAt(server, 50)).currentItem).toMatchObject({
      type: "filler",
      endsAt: iso(at(60)),
    });
  });

  it("refuses an edit that would change airing filler and keeps its resume time through routine ones", async () => {
    const { server, clock, reservation } = await reservedMovie();
    clock.set(at(50));

    const refused = await send(server, "DELETE", reservation);
    await send(
      server,
      "PATCH",
      `/channels/${CHANNEL_ID}/programming-assignments/${assignmentFixture.id}`,
      collectionAssignment("collection-fixture-001", "random"),
    );

    expect(refused.body.error).toMatchObject({
      code: "airing_filler_conflict",
    });
    expect((await nowAt(server, 50)).currentItem).toMatchObject({
      type: "filler",
      endsAt: iso(at(60)),
      resumeTime: "7:00 PM",
    });
  });

  it("keeps the schedule and its filler across a restart and in any chunk size", async () => {
    const whole = await reservedMovie();
    const expected = await windowShape(whole.server, T0, at(600));
    const restarted = await startScheduleServer(
      whole.dataDirectory,
      whole.clock,
      "restart",
      { programmingTimezone: TIME_ZONE },
    );
    expect(await windowShape(restarted.server, T0, at(600))).toEqual(expected);
    await cleanUpTestEnvironment();

    const chunked = await reservedMovie({ entriesPerTransaction: 2 });

    expect(await windowShape(chunked.server, T0, at(600))).toEqual(expected);
  });
});

describe("spec 0005 acceptance: reservations override both rule behaviors", () => {
  it.each(["join", "feature"] as const)(
    "airs the reserved movie at its exact start while a %s rule wins",
    async (behavior) => {
      const context = await startScheduleScenarioServer();
      await send(
        context.server,
        "POST",
        `/channels/${CHANNEL_ID}/programming-rules`,
        {
          name: "Always",
          behavior,
          priority: 1,
          sources: [{ assignmentId: assignmentFixture.id }],
        },
      );
      const movie = await insertMovie(context.db);
      await reserveItems(context.server, at(60), [movie]);

      const { programs } = await windowShape(context.server, T0, at(160));

      expect(programs).toContain(`${movie}@${iso(at(60))}`);
      expect(programs.at(-1)).toBe(`item-003@${iso(at(150))}`);
    },
  );
});

describe("spec 0004 acceptance: reservations and kraziPlan turns", () => {
  it("lets the interrupted turn yield and resumes collection progress after the reservation", async () => {
    const { db } = await reservedMovie();

    // Turn-level retention and redraw are proven in kraziBrain's
    // krazi-plan/reservations.test.ts; here, the stored blocks show the
    // started turn ended at the reservation and a new one began after it.
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    const before = entries.find((entry) => entry.starts_at === at(22));
    const after = entries.find((entry) => entry.starts_at === at(150));
    expect(after?.programming_block_id).not.toBe(before?.programming_block_id);
    expect(after?.media_item_id).toBe("item-003");
  });

  it("preserves published reservations through a fresh rebuild and an assignment edit", async () => {
    const { server, movie } = await reservedMovie();

    await send(server, "POST", `/channels/${CHANNEL_ID}/programming/rebuild`, {
      idempotencyKey: "rebuild-1",
    });
    await send(
      server,
      "PATCH",
      `/channels/${CHANNEL_ID}/programming-assignments/${assignmentFixture.id}`,
      collectionAssignment("collection-fixture-001", "random"),
    );

    expect((await windowShape(server, T0, at(160))).programs).toContain(
      `${movie}@${iso(at(60))}`,
    );
    expect(
      (await send(server, "GET", `/channels/${CHANNEL_ID}/reservations`)).body,
    ).toHaveLength(1);
  });
});
