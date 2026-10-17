// Reservation setup for route and acceptance tests only; production code must never import this module.
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { iso, send, windowUrl } from "./api-requests.js";
import { FIXTURE_TIME } from "./catalog-fixtures.js";
import { channelFixture } from "./channel-fixtures.js";
import { insertCollectionOfItems } from "./schedule-fixtures.js";

/** Catalogs a `movies` collection of one 90-minute movie and returns its ID. */
export async function insertMovie(db: Kysely<DatabaseSchema>): Promise<string> {
  const [movie = ""] = await insertCollectionOfItems(db, "movies", [5_400_000]);
  return movie;
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
  const created = await send(
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
