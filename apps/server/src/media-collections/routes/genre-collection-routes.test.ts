import { afterEach, expect, it } from "vitest";

import { send } from "../../testing/api-requests.js";
import {
  rootFixture,
  titledItemFixture,
} from "../../testing/catalog-fixtures.js";
import { movieFacts } from "../../testing/collection-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const ACTION = { kind: "genre", name: "Action" } as const;

/**
 * Boots a server cataloging an Action movie, an Action Adventure movie, a
 * Family movie with Christmas in its title, and an unmatched file.
 */
async function startServer() {
  const { server } = await startTestServer({
    seed: async (db) => {
      await db.insertInto("media_roots").values(rootFixture).execute();
      await db
        .insertInto("media_items")
        .values([
          titledItemFixture("die-hard"),
          titledItemFixture("raiders"),
          titledItemFixture("christmas-vacation"),
          titledItemFixture("home-video"),
        ])
        .execute();
      await db
        .insertInto("content_facts")
        .values([
          {
            ...movieFacts("die-hard", null, "1988-07-15"),
            genres: '["Action","Thriller"]',
          },
          {
            ...movieFacts("raiders", null, "1981-06-12"),
            genres: '["Adventure","Action"]',
          },
          {
            ...movieFacts("christmas-vacation", null, "1989-11-30"),
            genres: '["Comedy","Family"]',
          },
        ])
        .execute();
    },
  });
  return server;
}

// Reads a member list response's IDs in position order.
function ids(members: unknown): string[] {
  return (members as { mediaItemId: string }[]).map((m) => m.mediaItemId);
}

it("lists accepted genres with the items each would include", async () => {
  const server = await startServer();

  const genres = await send(server, "GET", "/media-collections/genres");

  expect(genres.body).toEqual([
    { name: "Action", itemCount: 2 },
    { name: "Adventure", itemCount: 1 },
    { name: "Comedy", itemCount: 1 },
    { name: "Family", itemCount: 1 },
    { name: "Thriller", itemCount: 1 },
  ]);
});

it("previews only items with the genre, in release order, and creates exactly that", async () => {
  const server = await startServer();

  const preview = await send(server, "POST", "/media-collections/previews", {
    criterion: ACTION,
  });
  const created = await send(server, "POST", "/media-collections", {
    name: "Action",
    criterion: ACTION,
  });
  const members = await send(
    server,
    "GET",
    `/media-collections/${created.body.id as string}/items`,
  );

  expect(ids(preview.body)).toEqual(["raiders", "die-hard"]);
  expect(ids(members.body)).toEqual(ids(preview.body));
  expect(created.body).toMatchObject({ criterionLabel: "Action" });
});

it("never matches a collection's name: a Christmas collection on Action holds no Christmas movie", async () => {
  const server = await startServer();

  const created = await send(server, "POST", "/media-collections", {
    name: "Christmas",
    criterion: ACTION,
  });
  const members = await send(
    server,
    "GET",
    `/media-collections/${created.body.id as string}/items`,
  );

  expect(ids(members.body)).toEqual(["raiders", "die-hard"]);
});
