import { afterEach, describe, expect, it } from "vitest";

import { orderingChange } from "../../media-collections/maintenance/maintenance-writes.js";
import { iso, send, windowUrl } from "../../testing/api-requests.js";
import {
  FIXTURE_TIME,
  minutesAfterFixtureTime,
  titledItemFixture,
} from "../../testing/catalog-fixtures.js";
import {
  assignmentFixture,
  channelFixture,
} from "../../testing/channel-fixtures.js";
import { episodeFacts } from "../../testing/collection-fixtures.js";
import { correctionRow } from "../../testing/metadata-match-fixtures.js";
import { recordingLog } from "../../testing/recording-log.js";
import {
  readGuideAirings,
  saveReservation,
} from "../../testing/reservation-fixtures.js";
import {
  insertCollectionOfItems,
  readOnlyScheduleState,
} from "../../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
const at = minutesAfterFixtureTime;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = channelFixture.id;
const RESERVATIONS = `/channels/${CHANNEL_ID}/reservations`;
const SCHEDULE_URL = `/channels/${CHANNEL_ID}/schedule`;

// The episode scenario on a covered schedule, with a 90-minute movie
// collection the scenario's assignment does not play.
async function scheduled() {
  const context = await startScheduleScenarioServer();
  const [movie] = await insertCollectionOfItems(context.db, "movies", [
    90 * MINUTE,
  ]);
  await send(context.server, "GET", windowUrl(SCHEDULE_URL, T0, at(60)));
  return { ...context, movie: movie ?? "" };
}

// A media-item reservation body with a program-derived end unless given one.
function itemsBody(
  startsAt: number,
  mediaItemIds: string[],
  endsAt: number | null = null,
) {
  return {
    startsAt: iso(startsAt),
    endsAt: endsAt === null ? null : iso(endsAt),
    source: { kind: "media_items", mediaItemIds },
  };
}

describe("reservation routes", () => {
  it("airs the reserved program at its exact start after whole programs, leaving the gap empty", async () => {
    const { server, movie } = await scheduled();

    const created = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      channelId: CHANNEL_ID,
      startsAt: iso(at(60)),
      endsAt: iso(at(150)),
      endKind: "program_derived",
      source: { kind: "media_items", mediaItemIds: [movie] },
    });
    // The third episode would end at 69, past 60: it waits until after the
    // movie, and nothing is listed from 45 to 60.
    await expect(readGuideAirings(server, T0, at(175))).resolves.toEqual([
      "item-001@0-22",
      "item-002@22-45",
      `${movie}@60-150`,
      "item-003@150-174",
      "item-001@174-196",
    ]);
  });

  it("stores an explicit end and leaves the unused range without entries", async () => {
    const { server, movie } = await scheduled();

    const created = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie], at(180)),
    );

    expect(created.body).toMatchObject({
      endsAt: iso(at(180)),
      endKind: "explicit",
    });
    await expect(readGuideAirings(server, at(140), at(200))).resolves.toEqual([
      `${movie}@60-150`,
      "item-003@180-204",
    ]);
  });

  it("advances the schedule revision exactly once for each create, edit, and delete", async () => {
    const { server, db, movie } = await scheduled();
    const revision = async () =>
      (await readOnlyScheduleState(db)).schedule_revision;
    const before = await revision();

    const created = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );
    expect(await revision()).toBe(before + 1);
    const reservationUrl = `${RESERVATIONS}/${created.body.id as string}`;
    await saveReservation(
      server,
      "PATCH",
      reservationUrl,
      itemsBody(at(120), [movie]),
    );
    expect(await revision()).toBe(before + 2);
    // Saving the same settings changes nothing, so nothing regenerates.
    await saveReservation(
      server,
      "PATCH",
      reservationUrl,
      itemsBody(at(120), [movie]),
    );
    expect(await revision()).toBe(before + 2);
    const deleted = await send(server, "DELETE", reservationUrl);
    expect(deleted.status).toBe(204);
    expect(await revision()).toBe(before + 3);
    // Deleting returns the range to ordinary programming.
    await expect(readGuideAirings(server, at(115), at(135))).resolves.toEqual([
      "item-003@114-138",
    ]);
  });

  it("lists a channel's reservations in start order and reports an unknown channel", async () => {
    const { server, movie } = await scheduled();
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(300), [movie]),
    );
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );

    const listed = await send(server, "GET", RESERVATIONS);
    const unknown = await send(server, "GET", "/channels/nope/reservations");

    expect(
      (listed.body as { startsAt: string }[]).map(({ startsAt }) => startsAt),
    ).toEqual([iso(at(60)), iso(at(300))]);
    expect(unknown.status).toBe(404);
  });

  it("reports each listed reservation's status by the server's clock", async () => {
    const { server, clock, movie } = await scheduled();
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(300), [movie]),
    );
    clock.set(at(100));

    const listed = await send(server, "GET", RESERVATIONS);

    expect(
      (listed.body as { status: string }[]).map(({ status }) => status),
    ).toEqual(["running", "upcoming"]);
    clock.set(at(500));
    expect(
      (
        (await send(server, "GET", RESERVATIONS)).body as { status: string }[]
      ).map(({ status }) => status),
    ).toEqual(["ended", "ended"]);
  });

  it.each([
    {
      name: "a start that is not in the future",
      body: (movie: string) => itemsBody(T0, [movie]),
      status: 409,
      code: "reservation_in_past",
    },
    {
      name: "a start before the airing episode ends",
      body: (movie: string) => itemsBody(at(10), [movie]),
      status: 409,
      code: "reservation_crosses_airing",
    },
    {
      name: "an explicit end too short for the listed programs",
      body: (movie: string) => itemsBody(at(60), [movie], at(120)),
      status: 400,
      code: "reservation_does_not_fit",
    },
    {
      name: "an unknown media item",
      body: () => itemsBody(at(60), ["nope"]),
      status: 400,
      code: "media_item_not_found",
    },
    {
      name: "a collection without an explicit end",
      body: () => ({
        startsAt: iso(at(60)),
        source: {
          kind: "collection",
          mediaCollectionId: "movies",
          playbackMode: "chronological",
        },
      }),
      status: 400,
      code: "invalid_request",
    },
    {
      name: "an unknown collection",
      body: () => ({
        startsAt: iso(at(60)),
        endsAt: iso(at(120)),
        source: {
          kind: "collection",
          mediaCollectionId: "nope",
          playbackMode: "chronological",
        },
      }),
      status: 400,
      code: "media_collection_not_found",
    },
  ])("refuses $name", async ({ body, status, code }) => {
    const { server, db, movie } = await scheduled();
    const before = await readOnlyScheduleState(db);

    const refused = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      body(movie),
    );

    expect(refused.status).toBe(status);
    expect(refused.body.error.code).toBe(code);
    expect((await readOnlyScheduleState(db)).schedule_revision).toBe(
      before.schedule_revision,
    );
    await expect(send(server, "GET", RESERVATIONS)).resolves.toMatchObject({
      body: [],
    });
  });

  it("refuses media that cannot air", async () => {
    const { server, db } = await scheduled();
    await db
      .insertInto("media_items")
      .values(titledItemFixture("gone", { status: "missing" }))
      .execute();

    const refused = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), ["gone"]),
    );

    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: "reservation_media_unplayable",
      mediaItemIds: ["gone"],
    });
  });

  it("refuses a range overlapping another reservation, before or after an edit", async () => {
    const { server, movie } = await scheduled();
    const first = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );
    const second = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(200), [movie]),
    );

    const overlapping = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(140), [movie]),
    );
    const moved = await saveReservation(
      server,
      "PATCH",
      `${RESERVATIONS}/${second.body.id as string}`,
      itemsBody(at(100), [movie]),
    );

    // The other reservation is named by ID and range in the details, so the
    // web app can say which special by its time; the message carries no ID.
    for (const refused of [overlapping, moved]) {
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({
        code: "reservation_overlap",
        reservationId: first.body.id,
        startsAt: first.body.startsAt,
        endsAt: first.body.endsAt,
      });
      expect(refused.body.error.message).not.toContain(first.body.id);
    }
  });

  it("refuses editing a reservation that has started and reports one on another channel as missing", async () => {
    const { server, clock, movie } = await scheduled();
    const created = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );
    const reservationUrl = `${RESERVATIONS}/${created.body.id as string}`;
    clock.set(at(70));

    const started = await saveReservation(
      server,
      "PATCH",
      reservationUrl,
      itemsBody(at(300), [movie]),
    );
    const elsewhere = await send(
      server,
      "DELETE",
      `/channels/other/reservations/${created.body.id as string}`,
    );

    expect(started.status).toBe(409);
    expect(started.body.error.code).toBe("reservation_started");
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.body.error).toEqual({
      code: "reservation_not_found",
      message: "The channel has no such reservation",
      channelId: "other",
      reservationId: created.body.id,
    });
  });

  it("airs a collection's programs that fit and consumes its progress across reservations", async () => {
    const { server, db } = await scheduled();
    await insertCollectionOfItems(
      db,
      "specials",
      [50, 50, 50].map((m) => m * MINUTE),
    );
    const collection = (startsAt: number, endsAt: number) => ({
      startsAt: iso(startsAt),
      endsAt: iso(endsAt),
      source: {
        kind: "collection",
        mediaCollectionId: "specials",
        playbackMode: "chronological",
      },
    });

    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      collection(at(60), at(180)),
    );
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      collection(at(300), at(360)),
    );

    const listed = await readGuideAirings(server, at(55), at(370));
    expect(listed).toContain("specials-1@60-110");
    expect(listed).toContain("specials-2@110-160");
    expect(listed).toContain("specials-3@300-350");
  });

  it("refuses removing media or deleting a collection a reservation plays, naming the special", async () => {
    const { server, db, movie } = await scheduled();
    await insertCollectionOfItems(db, "specials", [50 * MINUTE]);
    const movieNight = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );
    const marathon = await saveReservation(server, "POST", RESERVATIONS, {
      startsAt: iso(at(300)),
      endsAt: iso(at(400)),
      source: {
        kind: "collection",
        mediaCollectionId: "specials",
        playbackMode: "chronological",
      },
    });

    const removal = await send(server, "POST", "/catalog-removals", {
      target: { mediaItemIds: [movie] },
    });
    const deletion = await send(
      server,
      "DELETE",
      "/media-collections/specials",
    );

    expect(removal.status).toBe(409);
    expect(removal.body.error).toMatchObject({
      code: "media_item_in_use",
      channelIds: [CHANNEL_ID],
      reservations: [
        {
          id: movieNight.body.id,
          channelId: CHANNEL_ID,
          startsAt: iso(at(60)),
        },
      ],
    });
    expect(deletion.status).toBe(409);
    expect(deletion.body.error).toMatchObject({
      code: "media_collection_in_use",
      reservations: [
        { id: marathon.body.id, channelId: CHANNEL_ID, startsAt: iso(at(300)) },
      ],
    });
  });
});

// A collection reservation body for the `specials` collection.
function specialsBody(
  startsAt: number,
  endsAt: number,
  playbackMode = "chronological",
) {
  return {
    startsAt: iso(startsAt),
    endsAt: iso(endsAt),
    source: { kind: "collection", mediaCollectionId: "specials", playbackMode },
  };
}

describe("reservation routes: revision, progress, and history", () => {
  it("advances the revision once even when regeneration changes no entry", async () => {
    const { server, db, movie } = await scheduled();
    // Without its assignment the channel has no programming, so later
    // regenerations neither delete nor insert an entry.
    await send(
      server,
      "DELETE",
      `/channels/${CHANNEL_ID}/programming-assignments/${assignmentFixture.id}`,
    );
    const revision = async () =>
      (await readOnlyScheduleState(db)).schedule_revision;
    const before = await revision();

    const created = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );
    expect(created.status).toBe(201);
    expect(await revision()).toBe(before + 1);
    await send(
      server,
      "DELETE",
      `${RESERVATIONS}/${created.body.id as string}`,
    );
    expect(await revision()).toBe(before + 2);
  });

  it("continues a reserved collection from its stored progress", async () => {
    const { server, db, clock } = await scheduled();
    await insertCollectionOfItems(
      db,
      "specials",
      [50, 50, 50].map((minutes) => minutes * MINUTE),
    );
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      specialsBody(at(60), at(180)),
    );
    // The first reservation's programs have aired, so the next write keeps
    // them and must read where they left the collection from storage.
    clock.set(at(170));

    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      specialsBody(at(300), at(360)),
    );

    await expect(readGuideAirings(server, at(290), at(360))).resolves.toContain(
      "specials-3@300-350",
    );
  });

  it("regenerates a reserved collection when its episode order changes", async () => {
    const { server, db, dependencies } = await scheduled();
    const ids = await insertCollectionOfItems(
      db,
      "specials",
      [50, 50, 50].map((minutes) => minutes * MINUTE),
    );
    await db
      .insertInto("content_facts")
      .values(ids.map((id, index) => episodeFacts(id, 1399, 1, index + 1)))
      .execute();
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      specialsBody(at(60), at(240), "episode"),
    );
    await db
      .insertInto("metadata_corrections")
      .values(correctionRow("specials-1", { episode_number: 9 }))
      .execute();

    await dependencies.schedules.applyInputChange(
      recordingLog(),
      "ordering_changed",
      orderingChange(),
    );

    await expect(readGuideAirings(server, at(55), at(215))).resolves.toEqual(
      expect.arrayContaining([
        "specials-2@60-110",
        "specials-3@110-160",
        "specials-1@160-210",
      ]),
    );
  });

  it("accepts a reservation that starts exactly when another ends", async () => {
    const { server, movie } = await scheduled();
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );

    const touching = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(150), [movie]),
    );

    expect(touching.status).toBe(201);
  });

  it("refuses an item removed from the catalog", async () => {
    const { server, db } = await scheduled();
    await db
      .insertInto("media_items")
      .values(titledItemFixture("removed", { removed_at: T0 }))
      .execute();

    const refused = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), ["removed"]),
    );

    expect(refused.body.error).toMatchObject({
      code: "reservation_media_unplayable",
      mediaItemIds: ["removed"],
    });
  });

  it("edits a reservation to an explicit end and reports unknown ones on the right channel", async () => {
    const { server, movie } = await scheduled();
    const created = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );

    const edited = await saveReservation(
      server,
      "PATCH",
      `${RESERVATIONS}/${created.body.id as string}`,
      itemsBody(at(60), [movie], at(200)),
    );
    const patchUnknown = await saveReservation(
      server,
      "PATCH",
      `${RESERVATIONS}/nope`,
      itemsBody(at(60), [movie]),
    );
    const deleteUnknown = await send(server, "DELETE", `${RESERVATIONS}/nope`);

    expect(edited.body).toMatchObject({
      endsAt: iso(at(200)),
      endKind: "explicit",
    });
    expect(patchUnknown.status).toBe(404);
    expect(deleteUnknown.status).toBe(404);
  });

  it("keeps the airing program when its reservation is deleted and returns the rest to rotation", async () => {
    const { server, clock, movie } = await scheduled();
    const created = await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );
    clock.set(at(70));

    const deleted = await send(
      server,
      "DELETE",
      `${RESERVATIONS}/${created.body.id as string}`,
    );

    expect(deleted.status).toBe(204);
    await expect(readGuideAirings(server, at(55), at(160))).resolves.toEqual([
      `${movie}@60-150`,
      "item-003@150-174",
    ]);
  });

  it("regenerates a channel when a collection only a reservation plays changes", async () => {
    const { server, db } = await scheduled();
    await insertCollectionOfItems(db, "specials", [50 * MINUTE]);
    await db
      .insertInto("media_items")
      .values(titledItemFixture("pilot", { duration_ms: 40 * MINUTE }))
      .execute();
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      specialsBody(at(60), at(180)),
    );

    await send(server, "PUT", "/media-collections/specials/items", {
      mediaItemIds: ["pilot", "specials-1"],
    });

    await expect(readGuideAirings(server, at(55), at(160))).resolves.toEqual(
      expect.arrayContaining(["pilot@60-100", "specials-1@100-150"]),
    );
  });

  it("lets ended reservations go when their media is removed or their collection deleted", async () => {
    const { server, db, clock, movie } = await scheduled();
    await insertCollectionOfItems(db, "specials", [50 * MINUTE]);
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      itemsBody(at(60), [movie]),
    );
    await saveReservation(
      server,
      "POST",
      RESERVATIONS,
      specialsBody(at(150), at(200)),
    );
    clock.set(at(210));

    const removal = await send(server, "POST", "/catalog-removals", {
      target: { mediaItemIds: [movie] },
    });
    const deletion = await send(
      server,
      "DELETE",
      "/media-collections/specials",
    );

    expect(removal.status).toBe(200);
    expect(deletion.status).toBe(204);
    await expect(send(server, "GET", RESERVATIONS)).resolves.toMatchObject({
      body: [],
    });
  });
});
