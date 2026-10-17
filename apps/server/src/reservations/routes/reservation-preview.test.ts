import { afterEach, describe, expect, it } from "vitest";

import { iso, send, windowUrl } from "../../testing/api-requests.js";
import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import { movieFacts } from "../../testing/collection-fixtures.js";
import {
  insertMovie,
  saveReservation,
} from "../../testing/reservation-fixtures.js";
import {
  insertCollectionOfItems,
  readOnlyScheduleState,
  readScheduleEntries,
} from "../../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
const at = (minutes: number) => T0 + minutes * MINUTE;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = "channel-fixture-001";
const RESERVATIONS = `/channels/${CHANNEL_ID}/reservations`;
const PREVIEW = `${RESERVATIONS}/preview`;

// The episode scenario on a covered schedule with a 90-minute movie.
async function scheduled() {
  const context = await startScheduleScenarioServer();
  const movie = await insertMovie(context.db);
  await send(
    context.server,
    "GET",
    windowUrl(`/channels/${CHANNEL_ID}/schedule`, T0, at(60)),
  );
  return { ...context, movie };
}

// The movie reserved at `startsAt`, with a program-derived end unless given one.
const movieAt = (movie: string, startsAt: number, endsAt?: number) => ({
  startsAt: iso(startsAt),
  ...(endsAt === undefined ? {} : { endsAt: iso(endsAt) }),
  source: { kind: "media_items", mediaItemIds: [movie] },
});

describe("POST /channels/:id/reservations/preview", () => {
  it("previews exactly what saving the reservation then produces", async () => {
    const { server, db, movie } = await scheduled();
    const revision = (await readOnlyScheduleState(db)).schedule_revision;

    const preview = await send(server, "POST", PREVIEW, movieAt(movie, at(60)));

    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({
      scheduleRevision: revision,
      commitment: "exact",
      startsAt: iso(at(60)),
      endsAt: iso(at(150)),
      endKind: "program_derived",
      beyondHorizon: false,
      programs: [
        {
          mediaItemId: movie,
          title: movie,
          startsAt: iso(at(60)),
          endsAt: iso(at(150)),
          estimated: false,
        },
      ],
      // The third episode would end at 69, so it waits until after the movie.
      fillerBefore: { startsAt: iso(at(45)), endsAt: iso(at(60)) },
      fillerInside: null,
      deferredProgram: { mediaItemId: "item-003", title: "Item 3" },
      resumesWith: {
        mediaItemId: "item-003",
        title: "Item 3",
        startsAt: iso(at(150)),
      },
      conflicts: [],
    });

    await saveReservation(server, "POST", RESERVATIONS, movieAt(movie, at(60)));
    const saved = await send(
      server,
      "GET",
      windowUrl(`/channels/${CHANNEL_ID}/schedule`, at(40), at(160)),
    );
    expect(saved.body.fillerIntervals).toMatchObject([
      preview.body.fillerBefore,
    ]);
    expect(
      (saved.body.entries as { mediaItemId: string; startsAt: string }[]).map(
        ({ mediaItemId, startsAt }) => ({ mediaItemId, startsAt }),
      ),
    ).toEqual([
      { mediaItemId: "item-002", startsAt: iso(at(22)) },
      { mediaItemId: movie, startsAt: iso(at(60)) },
      { mediaItemId: "item-003", startsAt: iso(at(150)) },
    ]);
  });

  it("writes nothing and leaves the schedule revision unchanged", async () => {
    const { server, db, movie } = await scheduled();
    const before = await readScheduleEntries(db, CHANNEL_ID);
    const revision = (await readOnlyScheduleState(db)).schedule_revision;

    await send(server, "POST", PREVIEW, movieAt(movie, at(60)));

    expect((await readOnlyScheduleState(db)).schedule_revision).toBe(revision);
    await expect(readScheduleEntries(db, CHANNEL_ID)).resolves.toEqual(before);
    await expect(send(server, "GET", RESERVATIONS)).resolves.toMatchObject({
      body: [],
    });
  });

  it("shows the unused time inside an explicit range as filler", async () => {
    const { server, movie } = await scheduled();

    const preview = await send(
      server,
      "POST",
      PREVIEW,
      movieAt(movie, at(60), at(180)),
    );

    expect(preview.body).toMatchObject({
      endKind: "explicit",
      fillerInside: { startsAt: iso(at(150)), endsAt: iso(at(180)) },
    });
  });

  it("reports why a reservation could not be saved instead of previewing it", async () => {
    const { server, movie } = await scheduled();

    const preview = await send(server, "POST", PREVIEW, movieAt(movie, at(10)));

    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      commitment: "exact",
      conflicts: [
        {
          code: "reservation_crosses_airing",
          airingEndsAt: iso(at(22)),
        },
      ],
    });
    expect(preview.body.programs).toBeUndefined();
  });

  it("leaves reservation programs out of the rotation turns a programming preview shows", async () => {
    const { server, movie } = await scheduled();
    await saveReservation(server, "POST", RESERVATIONS, movieAt(movie, at(60)));

    const programming = await send(
      server,
      "GET",
      `/channels/${CHANNEL_ID}/programming-preview`,
    );

    const aired = (
      programming.body.turns as { programs: { mediaItemId: string }[] }[]
    ).flatMap((turn) => turn.programs.map(({ mediaItemId }) => mediaItemId));
    expect(aired.length).toBeGreaterThan(0);
    expect(aired).not.toContain(movie);
  });

  describe("beyond the horizon", () => {
    const DAY = 24 * 60 * MINUTE;
    const later = T0 + 5 * DAY;

    it("says the surrounding schedule is planned later and displaces nothing, previewing listed items exactly", async () => {
      const { server, movie } = await scheduled();

      const preview = await send(
        server,
        "POST",
        PREVIEW,
        movieAt(movie, later),
      );

      expect(preview.body).toMatchObject({
        beyondHorizon: true,
        programs: [
          { mediaItemId: movie, startsAt: iso(later), estimated: false },
        ],
        fillerBefore: null,
        deferredProgram: null,
      });
    });

    it("marks a collection's programs as estimated", async () => {
      const { server } = await scheduled();

      const preview = await send(server, "POST", PREVIEW, {
        startsAt: iso(later),
        endsAt: iso(later + 120 * MINUTE),
        source: {
          kind: "collection",
          mediaCollectionId: "movies",
          playbackMode: "chronological",
        },
      });

      expect(preview.body.beyondHorizon).toBe(true);
      expect(preview.body.programs).toMatchObject([
        { startsAt: iso(later), estimated: true },
      ]);
    });

    it("treats a special inside the horizon as planned", async () => {
      const { server } = await scheduled();

      const preview = await send(server, "POST", PREVIEW, {
        startsAt: iso(at(60)),
        endsAt: iso(at(180)),
        source: {
          kind: "collection",
          mediaCollectionId: "movies",
          playbackMode: "chronological",
        },
      });

      expect(preview.body.beyondHorizon).toBe(false);
      expect(preview.body.programs).toMatchObject([{ estimated: false }]);
    });
  });

  describe("a collection from the beginning", () => {
    const FILM_MS = 100 * MINUTE;

    // Eight films saved last-released first, so release order is the
    // reverse of saved order and the ordinary rotation's next film is not
    // the first one.
    async function films() {
      const context = await scheduled();
      const ids = await insertCollectionOfItems(
        context.db,
        "films",
        Array.from({ length: 8 }, () => FILM_MS),
      );
      await context.db
        .insertInto("content_facts")
        .values(
          ids.map((id, index) => movieFacts(id, null, `${2010 - index}-07-01`)),
        )
        .execute();
      return { ...context, ids };
    }

    const fromTheBeginning = (playbackMode: string) => ({
      startsAt: iso(at(60)),
      source: {
        kind: "collection_from_beginning",
        mediaCollectionId: "films",
        playbackMode,
      },
    });

    it("resolves every film once in release order, first film first, with a program-derived end", async () => {
      const { server, ids } = await films();

      const preview = await send(
        server,
        "POST",
        PREVIEW,
        fromTheBeginning("release"),
      );

      const firstReleased = [...ids].reverse();
      expect(preview.body).toMatchObject({
        mediaItemIds: firstReleased,
        endsAt: iso(at(60) + 8 * FILM_MS),
        endKind: "program_derived",
      });
      expect(
        (preview.body.programs as { mediaItemId: string }[]).map(
          (program) => program.mediaItemId,
        ),
      ).toEqual(firstReleased);
      const saved = await saveReservation(server, "POST", RESERVATIONS, {
        startsAt: iso(at(60)),
        source: {
          kind: "media_items",
          mediaItemIds: preview.body.mediaItemIds,
        },
      });
      expect(saved.status).toBe(201);
    });

    it("refuses a collection with an unavailable film, naming it", async () => {
      const { server, db } = await films();
      await db
        .updateTable("media_items")
        .set({ status: "missing" })
        .where("id", "=", "films-3")
        .execute();

      const preview = await send(
        server,
        "POST",
        PREVIEW,
        fromTheBeginning("release"),
      );

      expect(preview.body.conflicts).toMatchObject([
        { code: "reservation_media_unplayable", mediaItemIds: ["films-3"] },
      ]);
    });

    it("refuses random playback, and saving the collection itself, as invalid", async () => {
      const { server } = await films();

      const random = await send(
        server,
        "POST",
        PREVIEW,
        fromTheBeginning("random"),
      );
      const saved = await send(server, "POST", RESERVATIONS, {
        ...fromTheBeginning("release"),
        expectedScheduleRevision: null,
        requestKey: "save-1",
      });

      expect(random.body.error.code).toBe("invalid_request");
      expect(saved.body.error.code).toBe("invalid_request");
    });
  });

  it("previews an edit without the special it replaces", async () => {
    const { server, movie } = await scheduled();
    const saved = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      movieAt(movie, at(60)),
    );

    const asNew = await send(server, "POST", PREVIEW, movieAt(movie, at(90)));
    const asEdit = await send(server, "POST", PREVIEW, {
      ...movieAt(movie, at(90)),
      replacesReservationId: saved.body.id,
    });

    expect(asNew.body.conflicts).toMatchObject([
      { code: "reservation_overlap" },
    ]);
    expect(asEdit.body).toMatchObject({
      conflicts: [],
      programs: [{ mediaItemId: movie, startsAt: iso(at(90)) }],
    });
  });
});
