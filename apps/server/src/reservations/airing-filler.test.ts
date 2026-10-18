// Programming spec 0006: routine edits never change what airs, including
// planned filler, and a preparation an edit made stale never commits.
import { afterEach, describe, expect, it, vi } from "vitest";

import { SqliteTransitionCoordinator } from "../channels/runtime/sqlite-transition-coordinator.js";
import { iso, send, windowUrl } from "../testing/api-requests.js";
import { collectionAssignment } from "../testing/assignment-bodies.js";
import {
  collectionFixture,
  minutesAfterFixtureTime,
} from "../testing/catalog-fixtures.js";
import {
  assignmentFixture,
  channelFixture,
} from "../testing/channel-fixtures.js";
import {
  insertCollectionOfItems,
  readOnlyScheduleState,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import {
  insertMovie,
  reserveItems,
  saveReservation,
} from "../testing/reservation-fixtures.js";
import { startScheduleScenarioServer } from "../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const at = minutesAfterFixtureTime;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = channelFixture.id;
const COLLECTION_ID = collectionFixture.id;
const RESERVATIONS = `/channels/${CHANNEL_ID}/reservations`;
const ASSIGNMENT = `/channels/${CHANNEL_ID}/programming-assignments/${assignmentFixture.id}`;

// Episodes 0-22 and 22-45, filler 45-60, a 90-minute movie reserved at 60,
// and a later reservation at 300; the clock then stands inside the filler.
async function duringFiller() {
  const context = await startScheduleScenarioServer();
  const movie = await insertMovie(context.db);
  const leadsInto = await reserveItems(context.server, at(60), [movie]);
  const later = await reserveItems(context.server, at(300), [movie]);
  context.clock.set(at(50));
  const now = async () =>
    (
      await send(
        context.server,
        "GET",
        `/channels/${CHANNEL_ID}/now?at=${iso(at(50))}`,
      )
    ).body as { currentItem: unknown };
  const revision = async () =>
    (await readOnlyScheduleState(context.db)).schedule_revision;
  return { ...context, movie, leadsInto, later, now, revision };
}

const AIRING_FILLER = {
  type: "filler",
  startsAt: iso(at(45)),
  endsAt: iso(at(60)),
  resumeTime: "1:00 AM",
};

describe("edits while planned filler airs", () => {
  it("keeps the airing filler's end and resume time through an assignment edit, rebuilding only after it", async () => {
    const { server, db, now, revision } = await duringFiller();
    // An eight-minute program would fit in the filler if regeneration
    // started now rather than at the filler's end.
    await insertCollectionOfItems(db, "shorts", [8 * MINUTE]);
    const before = await readScheduleEntries(db, CHANNEL_ID);
    const revisionBefore = await revision();

    const edited = await send(
      server,
      "PATCH",
      ASSIGNMENT,
      collectionAssignment("shorts"),
    );

    expect(edited.status).toBe(200);
    expect((await now()).currentItem).toMatchObject(AIRING_FILLER);
    // Completing a horizon of short programs may commit more than one chunk.
    expect(await revision()).toBeGreaterThan(revisionBefore);
    // Everything before the filler's end stands; the rebuild starts there.
    const after = await readScheduleEntries(db, CHANNEL_ID);
    const kept = (entries: typeof before) =>
      entries.filter((entry) => entry.starts_at < at(60)).map(({ id }) => id);
    expect(kept(after)).toEqual(kept(before));
    expect(after.find((entry) => entry.starts_at === at(60))?.id).not.toBe(
      before.find((entry) => entry.starts_at === at(60))?.id,
    );
  });

  it.each([
    {
      name: "moving",
      request: (movie: string) =>
        [
          "PATCH",
          {
            startsAt: iso(at(75)),
            source: { kind: "media_items", mediaItemIds: [movie] },
          },
        ] as const,
    },
    { name: "deleting", request: () => ["DELETE", undefined] as const },
  ])(
    "refuses $name the reservation the airing filler leads into, changing nothing",
    async ({ request }) => {
      const { server, db, movie, leadsInto, now, revision } =
        await duringFiller();
      const before = await readScheduleEntries(db, CHANNEL_ID);
      const revisionBefore = await revision();
      const [method, body] = request(movie);

      const refused =
        method === "PATCH"
          ? await saveReservation(server, method, leadsInto, body)
          : await send(server, method, leadsInto, body);

      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({
        code: "airing_filler_conflict",
        fillerEndsAt: iso(at(60)),
      });
      expect(await revision()).toBe(revisionBefore);
      await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(
        before,
      );
      expect((await now()).currentItem).toMatchObject(AIRING_FILLER);
    },
  );

  it("refuses a new reservation starting before the airing filler ends", async () => {
    const { server, movie } = await duringFiller();

    const refused = await saveReservation(server, "POST", RESERVATIONS, {
      startsAt: iso(at(55)),
      source: { kind: "media_items", mediaItemIds: [movie] },
    });

    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: "reservation_crosses_airing",
      airingEndsAt: iso(at(60)),
    });
  });

  it("lets a later reservation change, changing its future filler but not the airing one", async () => {
    const { server, later, movie, now } = await duringFiller();
    const fillerBefore = async () =>
      (
        await send(
          server,
          "GET",
          windowUrl(`/channels/${CHANNEL_ID}/schedule`, at(200), at(400)),
        )
      ).body.fillerIntervals as { endsAt: string }[];
    expect((await fillerBefore()).map(({ endsAt }) => endsAt)).toContain(
      iso(at(300)),
    );

    const moved = await saveReservation(server, "PATCH", later, {
      startsAt: iso(at(330)),
      source: { kind: "media_items", mediaItemIds: [movie] },
    });

    expect(moved.status).toBe(200);
    const ends = (await fillerBefore()).map(({ endsAt }) => endsAt);
    expect(ends).toContain(iso(at(330)));
    expect(ends).not.toContain(iso(at(300)));
    expect((await now()).currentItem).toMatchObject(AIRING_FILLER);
  });

  it("reports a filler or program prepared before an edit as stale", async () => {
    const { server, db, clock, revision } = await duringFiller();
    const coordinator = new SqliteTransitionCoordinator(db, clock.now, {
      writeAuthorityWaitMs: 1_000,
    });
    const preparedUnder = await revision();
    const movieEntry = (await readScheduleEntries(db, CHANNEL_ID)).find(
      (entry) => entry.starts_at === at(60),
    );
    await send(
      server,
      "PATCH",
      ASSIGNMENT,
      collectionAssignment(COLLECTION_ID, "random"),
    );
    const commit = vi.fn();

    clock.set(at(50));
    await expect(
      coordinator.commitPreparedTransition(
        {
          channelId: CHANNEL_ID,
          cursor: { kind: "filler", endsAt: at(60) },
          scheduleRevision: preparedUnder,
        },
        commit,
      ),
    ).resolves.toBe("stale");
    clock.set(at(60));
    await expect(
      coordinator.commitPreparedTransition(
        {
          channelId: CHANNEL_ID,
          cursor: {
            kind: "program",
            scheduleEntryId: movieEntry?.id ?? "",
          },
          scheduleRevision: preparedUnder,
        },
        commit,
      ),
    ).resolves.toBe("stale");
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps the airing filler and the reserved movie when the last assignment is deleted", async () => {
    const { server, db, now } = await duringFiller();

    const deleted = await send(server, "DELETE", ASSIGNMENT);

    expect(deleted.status).toBe(204);
    expect((await now()).currentItem).toMatchObject(AIRING_FILLER);
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    expect(entries.find((entry) => entry.starts_at === at(60))).toMatchObject({
      media_item_id: "movies-1",
    });
  });

  it("previews programming from the airing filler's end, not from now", async () => {
    const { server, db } = await duringFiller();
    // An eight-minute program would fit before 60 if the preview started now.
    await insertCollectionOfItems(db, "shorts", [8 * MINUTE]);
    await send(server, "PATCH", ASSIGNMENT, collectionAssignment("shorts"));

    const preview = await send(
      server,
      "GET",
      `/channels/${CHANNEL_ID}/programming-preview`,
    );

    const starts = (
      preview.body.turns as { programs: { startsAt: string }[] }[]
    ).flatMap((turn) =>
      turn.programs.map(({ startsAt }) => Date.parse(startsAt)),
    );
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(at(60));
  });
});

describe("edits while a reservation's own tail filler airs", () => {
  // The movie airs 60-150 in a range reserved to 170; the clock stands in
  // the unused tail.
  async function duringTail() {
    const context = await startScheduleScenarioServer();
    const movie = await insertMovie(context.db);
    const reservation = await reserveItems(
      context.server,
      at(60),
      [movie],
      at(170),
    );
    await insertCollectionOfItems(context.db, "empty", []);
    context.clock.set(at(160));
    return { ...context, reservation };
  }

  it("refuses deleting the reservation whose tail is airing", async () => {
    const { server, reservation } = await duringTail();

    const refused = await send(server, "DELETE", reservation);

    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: "airing_filler_conflict",
      fillerEndsAt: iso(at(170)),
    });
  });

  it("refuses a reservation at exactly the filler's end that would merge into it, saving nothing", async () => {
    const { server, db } = await duringTail();
    const revisionBefore = (await readOnlyScheduleState(db)).schedule_revision;

    // Nothing in an empty collection fits, so its range would extend the airing filler.
    const refused = await saveReservation(server, "POST", RESERVATIONS, {
      startsAt: iso(at(170)),
      endsAt: iso(at(180)),
      source: {
        kind: "collection",
        mediaCollectionId: "empty",
        playbackMode: "chronological",
      },
    });

    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: "airing_filler_conflict",
      fillerEndsAt: iso(at(170)),
    });
    await expect(send(server, "GET", RESERVATIONS)).resolves.toMatchObject({
      body: [expect.objectContaining({ startsAt: iso(at(60)) })],
    });
    expect((await readOnlyScheduleState(db)).schedule_revision).toBe(
      revisionBefore,
    );
  });
});
