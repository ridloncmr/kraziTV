// Reservation setup for route and acceptance tests only; production code must never import this module.
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { iso, send } from "./api-requests.js";
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
 */
export async function reserveItems(
  server: FastifyInstance,
  startsAt: number,
  mediaItemIds: string[],
  endsAt?: number,
): Promise<string> {
  const created = await send(
    server,
    "POST",
    `/channels/${channelFixture.id}/reservations`,
    {
      startsAt: iso(startsAt),
      ...(endsAt === undefined ? {} : { endsAt: iso(endsAt) }),
      source: { kind: "media_items", mediaItemIds },
    },
  );
  if (created.status !== 201) {
    throw new Error(`reservation refused: ${JSON.stringify(created.body)}`);
  }
  return `/channels/${channelFixture.id}/reservations/${created.body.id as string}`;
}
