// Reservation setup for route and acceptance tests only; production code must never import this module.
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { iso, send, windowUrl } from "./api-requests.js";
import { FIXTURE_TIME } from "./catalog-fixtures.js";
import { channelFixture } from "./channel-fixtures.js";
import { movieFacts } from "./collection-fixtures.js";
import { insertCollectionOfItems } from "./schedule-fixtures.js";

/** Catalogs a `movies` collection of one 90-minute movie and returns its ID. */
export async function insertMovie(db: Kysely<DatabaseSchema>): Promise<string> {
  const [movie = ""] = await insertCollectionOfItems(db, "movies", [5_400_000]);
  return movie;
}

/** How long each film of `insertFilmSeries` runs. */
export const FILM_MS = 100 * 60_000;

/**
 * Catalogs a `films` collection of `count` films saved last-released first,
 * so release order is the reverse of saved order, and returns their IDs in
 * saved order. A full-series event's first film is then the last one saved.
 */
export async function insertFilmSeries(
  db: Kysely<DatabaseSchema>,
  count: number,
): Promise<string[]> {
  const ids = await insertCollectionOfItems(
    db,
    "films",
    Array.from({ length: count }, () => FILM_MS),
  );
  await db
    .insertInto("content_facts")
    .values(
      ids.map((id, index) => movieFacts(id, null, `${2010 - index}-07-01`)),
    )
    .execute();
  return ids;
}

/**
 * Saves a reservation on the fixture channel as the browser does: previews
 * the settings to read the schedule revision, then sends the save with it
 * and, for a create, a fresh request key. A body may override either guard,
 * as a stale or retried save would. Answers the save's response.
 */
export async function saveReservation(
  server: FastifyInstance,
  method: "POST" | "PATCH",
  url: string,
  body: Record<string, unknown>,
) {
  const { expectedScheduleRevision: _, requestKey: __, ...settings } = body;
  const preview = await send(
    server,
    "POST",
    `/channels/${channelFixture.id}/reservations/preview`,
    settings,
  );
  return send(server, method, url, {
    expectedScheduleRevision:
      // An unschedulable channel's preview names it on its refusal.
      ((preview.body?.scheduleRevision ??
        preview.body?.error?.scheduleRevision) as number | null | undefined) ??
      null,
    ...(method === "POST" ? { requestKey: randomUUID() } : {}),
    ...body,
  });
}

/**
 * Reserves media items on the fixture channel through the API, with a
 * program-derived end unless one is given, and returns the reservation's URL.
 * A start of "now" and `interrupts` pass through as the owner sends them.
 */
export async function reserveItems(
  server: FastifyInstance,
  startsAt: number | "now",
  mediaItemIds: string[],
  endsAt?: number,
  { interrupts }: { interrupts?: boolean } = {},
): Promise<string> {
  const created = await saveReservation(
    server,
    "POST",
    `/channels/${channelFixture.id}/reservations`,
    {
      startsAt: startsAt === "now" ? "now" : iso(startsAt),
      ...(endsAt === undefined ? {} : { endsAt: iso(endsAt) }),
      ...(interrupts === undefined ? {} : { interrupts }),
      source: { kind: "media_items", mediaItemIds },
    },
  );
  if (created.status !== 201) {
    throw new Error(`reservation refused: ${JSON.stringify(created.body)}`);
  }
  return `/channels/${channelFixture.id}/reservations/${created.body.id as string}`;
}

/**
 * Lists the fixture channel's guide entries in `[start, end)` as
 * `<media>@<minutes after FIXTURE_TIME>-<end>`, so a test reads the schedule
 * as a sequence of airings, cuts included.
 */
export async function readGuideAirings(
  server: FastifyInstance,
  start: number,
  end: number,
): Promise<string[]> {
  const window = await send(
    server,
    "GET",
    windowUrl(`/channels/${channelFixture.id}/schedule`, start, end),
  );
  const entries = window.body.entries as {
    mediaItemId: string;
    startsAt: string;
    endsAt: string;
  }[];
  const minutes = (instant: string) =>
    (Date.parse(instant) - FIXTURE_TIME) / 60_000;
  return entries.map(
    (entry) =>
      `${entry.mediaItemId}@${minutes(entry.startsAt)}-${minutes(entry.endsAt)}`,
  );
}
