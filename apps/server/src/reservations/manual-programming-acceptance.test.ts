// Programming spec 0007 acceptance, with spec 0004's full-series criterion
// that waited on it: specials published through the API beside default
// programming, read back through the schedule window, across a restart and
// chunked coverage. Criteria proven in focused suites are cited in the
// MAN-010 Status block of the implementation plan instead of repeated here.
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { iso, send, windowUrl } from "../testing/api-requests.js";
import {
  FIXTURE_TIME,
  minutesAfterFixtureTime,
} from "../testing/catalog-fixtures.js";
import { channelFixture } from "../testing/channel-fixtures.js";
import {
  FILM_MS,
  insertFilmSeries,
  insertMovie,
  readGuideAirings,
  reserveItems,
  saveReservation,
} from "../testing/reservation-fixtures.js";
import {
  readOnlyScheduleState,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import {
  startScheduleScenarioServer,
  startScheduleServer,
} from "../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const T0 = FIXTURE_TIME;
const at = minutesAfterFixtureTime;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = channelFixture.id;
const RESERVATIONS = `/channels/${CHANNEL_ID}/reservations`;

// Previews the films from the beginning in release order and saves the list
// it resolves to, as My Channels does, starting at `startsAt`.
async function saveFullSeries(server: FastifyInstance, startsAt: number) {
  const preview = await send(server, "POST", `${RESERVATIONS}/preview`, {
    startsAt: iso(startsAt),
    source: {
      kind: "collection_from_beginning",
      mediaCollectionId: "films",
      playbackMode: "release",
    },
  });
  const saved = await saveReservation(server, "POST", RESERVATIONS, {
    startsAt: iso(startsAt),
    source: { kind: "media_items", mediaItemIds: preview.body.mediaItemIds },
  });
  return { preview, saved };
}

// The episode scenario with eight films and the schedule covered from T0.
async function withFilms(
  options: Parameters<typeof startScheduleScenarioServer>[1] = {},
) {
  const context = await startScheduleScenarioServer({}, options);
  const films = await insertFilmSeries(context.db, 8);
  await readGuideAirings(context.server, T0, at(60));
  return { ...context, films, firstReleased: [...films].reverse() };
}

describe("spec 0007 acceptance", () => {
  it("publishes a movie night that changes only its own validated scope", async () => {
    const { server, db } = await withFilms();
    const movie = await insertMovie(db);
    const before = await readGuideAirings(server, T0, at(240));

    await reserveItems(server, at(300), [movie]);

    // Everything before the special stands; it airs at its exact time.
    expect(await readGuideAirings(server, T0, at(240))).toEqual(before);
    expect(await readGuideAirings(server, at(299), at(390))).toContain(
      `${movie}@300-390`,
    );
  });

  it("publishes a full series from the beginning once, in order, without wrapping, and leaves ordinary progress alone", async () => {
    const { server, firstReleased } = await withFilms();

    const { preview, saved } = await saveFullSeries(server, at(60));

    expect(preview.body.mediaItemIds).toEqual(firstReleased);
    expect(saved.status).toBe(201);
    expect(saved.body.endsAt).toBe(iso(at(60) + 8 * FILM_MS));
    const filmAirings = (
      await readGuideAirings(server, at(59), at(60) + 9 * FILM_MS)
    ).filter((airing) => airing.startsWith("films-"));
    expect(filmAirings).toEqual(
      firstReleased.map(
        (id, index) => `${id}@${60 + index * 100}-${160 + index * 100}`,
      ),
    );
    // The films are direct placements, so the ordinary collection resumes
    // exactly where it left off: the third episode, deferred past the event
    // (the kraziBrain reservation tests prove turns and marathon decisions
    // are untouched as well).
    expect(
      await readGuideAirings(
        server,
        at(60) + 8 * FILM_MS,
        at(60) + 8 * FILM_MS + 1,
      ),
    ).toEqual([`item-003@${60 + 800}-${60 + 800 + 24}`]);
  });

  it("refuses a full series with an unavailable film, and keeps saved placements through membership edits", async () => {
    const { server, db, films, firstReleased } = await withFilms();
    await db
      .updateTable("media_items")
      .set({ status: "missing" })
      .where("id", "=", "films-4")
      .execute();
    const refused = await send(server, "POST", `${RESERVATIONS}/preview`, {
      startsAt: iso(at(60)),
      source: {
        kind: "collection_from_beginning",
        mediaCollectionId: "films",
        playbackMode: "release",
      },
    });
    expect(refused.body.conflicts).toMatchObject([
      { code: "reservation_media_unplayable", mediaItemIds: ["films-4"] },
    ]);
    await db
      .updateTable("media_items")
      .set({ status: "available" })
      .where("id", "=", "films-4")
      .execute();
    await saveFullSeries(server, at(60));

    // Dropping half the films from the collection changes nothing saved.
    await send(server, "PUT", "/media-collections/films/items", {
      mediaItemIds: films.slice(0, 4),
    });

    const listed = await send(server, "GET", RESERVATIONS);
    expect(listed.body[0].source).toEqual({
      kind: "media_items",
      mediaItemIds: firstReleased,
    });
    expect(
      (await readGuideAirings(server, at(59), at(60) + 9 * FILM_MS)).filter(
        (airing) => airing.startsWith("films-"),
      ),
    ).toHaveLength(8);
  });

  it("resumes the saved placements across a restart and in any chunk size", async () => {
    const whole = await withFilms();
    await saveFullSeries(whole.server, at(60));
    const window = [T0, at(60) + 10 * FILM_MS] as const;
    const expected = await readGuideAirings(whole.server, ...window);
    const revision = (await readOnlyScheduleState(whole.db)).schedule_revision;
    const restarted = await startScheduleServer(
      whole.dataDirectory,
      whole.clock,
      "restart",
    );
    expect(await readGuideAirings(restarted.server, ...window)).toEqual(
      expected,
    );
    expect((await readOnlyScheduleState(whole.db)).schedule_revision).toBe(
      revision,
    );
    await cleanUpTestEnvironment();

    const chunked = await withFilms({ entriesPerTransaction: 2 });
    await saveFullSeries(chunked.server, at(60));

    expect(await readGuideAirings(chunked.server, ...window)).toEqual(expected);
  });

  it("keeps a special booked beyond the horizon until generation reaches it", async () => {
    const { server, db, clock } = await withFilms();
    const movie = await insertMovie(db);
    const later = T0 + 10 * DAY;

    await reserveItems(server, later, [movie]);

    expect(
      (await readScheduleEntries(db, CHANNEL_ID)).some(
        (entry) => entry.starts_at === later,
      ),
    ).toBe(false);
    // Long after coverage lapsed, as after days off the air, gap repair
    // reaches the special instead of rebuilding from past it.
    clock.set(T0 + 8 * DAY);
    await send(
      server,
      "GET",
      windowUrl(`/channels/${CHANNEL_ID}/schedule`, clock.now(), later),
    );
    expect(
      await readGuideAirings(server, later - MINUTE, later + 90 * MINUTE),
    ).toContain(
      `${movie}@${(later - T0) / MINUTE}-${(later - T0) / MINUTE + 90}`,
    );
  });

  it("restores generated programming when a future special is cancelled, keeping the other", async () => {
    const { server, db } = await withFilms();
    const movie = await insertMovie(db);
    const unreserved = await readGuideAirings(server, T0, at(240));
    const first = await reserveItems(server, at(120), [movie]);
    await reserveItems(server, at(400), [movie]);

    await send(server, "DELETE", first);

    expect(await readGuideAirings(server, T0, at(240))).toEqual(unreserved);
    expect(await readGuideAirings(server, at(399), at(490))).toContain(
      `${movie}@400-490`,
    );
  });

  it("leaves the airing program untouched by routine publication and cancellation", async () => {
    const { server, db, clock } = await withFilms();
    const movie = await insertMovie(db);
    clock.set(at(5));
    const airing = (await readScheduleEntries(db, CHANNEL_ID)).find(
      (entry) => entry.starts_at === T0,
    );

    const special = await reserveItems(server, at(200), [movie]);
    await send(server, "DELETE", special);

    expect(
      (await readScheduleEntries(db, CHANNEL_ID)).find(
        (entry) => entry.starts_at === T0,
      ),
    ).toEqual(airing);
  });
});
