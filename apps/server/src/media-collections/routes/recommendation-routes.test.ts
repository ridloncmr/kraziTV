import { afterEach, describe, expect, it } from "vitest";

import { send } from "../../testing/api-requests.js";
import { titledItemFixture } from "../../testing/catalog-fixtures.js";
import {
  episodeFacts,
  movieFacts,
  seedEpisodes,
} from "../../testing/collection-fixtures.js";
import { tagItem } from "../../testing/metadata-match-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const OFFICE = { kind: "series", tmdbId: 2316 } as const;
const INDY = { kind: "franchise", tmdbId: 84 } as const;
const RECOMMENDATIONS = "/media-collections/recommendations";

/**
 * Boots a server cataloging two Office episodes, one Parks episode, two
 * Indiana Jones movies sharing the Action genre, and Alien, with one Office
 * episode tagged. Only The Office and Indiana Jones reach the threshold.
 */
async function startServer() {
  const started = await startTestServer({
    seed: async (db) => {
      await seedEpisodes(db, [
        ["e1", 1, 1],
        ["e2", 1, 2],
      ]);
      await db
        .insertInto("media_items")
        .values(
          ["p1", "raiders", "crusade", "alien"].map((id) =>
            titledItemFixture(id),
          ),
        )
        .execute();
      const indy = { tmdbId: 84, name: "Indiana Jones Collection" };
      await db
        .insertInto("content_facts")
        .values([
          { ...episodeFacts("p1", 8592, 1, 1), series_name: "Parks" },
          {
            ...movieFacts("raiders", indy, "1981-06-12"),
            genres: '["Action"]',
          },
          {
            ...movieFacts("crusade", indy, "1989-05-24"),
            genres: '["Action"]',
          },
          movieFacts(
            "alien",
            { tmdbId: 8091, name: "Alien Collection" },
            "1979-05-25",
          ),
        ])
        .execute();
      await tagItem(db, "e1", ["Favorites"]);
    },
  });
  return started;
}

type Server = Awaited<ReturnType<typeof startServer>>["server"];

// Reads the recommendations, or the dismissed ones, as name and decision.
async function listed(server: Server, dismissed = false) {
  const { body } = await send(
    server,
    "GET",
    dismissed ? `${RECOMMENDATIONS}?dismissed=true` : RECOMMENDATIONS,
  );
  return (body as { name: string; collectionId: string | null }[]).map(
    ({ name, collectionId }) => ({ name, created: collectionId !== null }),
  );
}

// Accepts a recommendation as an automatic or manual collection.
function accept(
  server: Server,
  criterion: object,
  mode: "automatic" | "manual",
) {
  return send(server, "POST", `${RECOMMENDATIONS}/acceptance`, {
    criterion,
    mode,
  });
}

describe("collection recommendations", () => {
  it("suggests series and franchises with two or more items, with reason, count, and preview, creating nothing", async () => {
    const { server } = await startServer();

    const { body } = await send(server, "GET", RECOMMENDATIONS);

    expect(body).toEqual([
      {
        criterion: INDY,
        name: "Indiana Jones Collection",
        reason: "2 cataloged movies of the Indiana Jones Collection franchise",
        memberCount: 2,
        members: [
          expect.objectContaining({ mediaItemId: "raiders" }),
          expect.objectContaining({ mediaItemId: "crusade" }),
        ],
        collectionId: null,
        decision: null,
      },
      {
        criterion: OFFICE,
        name: "The Office",
        reason: "2 cataloged episodes of the TV series The Office",
        memberCount: 2,
        members: [
          expect.objectContaining({ mediaItemId: "e1" }),
          expect.objectContaining({ mediaItemId: "e2" }),
        ],
        collectionId: null,
        decision: null,
      },
    ]);
    expect((await send(server, "GET", "/media-collections")).body).toEqual([]);
  });

  it("creates one collection when two acceptances race, and then shows it as already created", async () => {
    const { server } = await startServer();

    const [first, second] = await Promise.all([
      accept(server, OFFICE, "automatic"),
      accept(server, OFFICE, "automatic"),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const refused = first.status === 409 ? first : second;
    expect(refused.body.error.code).toBe("recommendation_decided");
    expect(
      (await send(server, "GET", "/media-collections")).body,
    ).toMatchObject([
      { name: "The Office", maintenanceMode: "automatic", criterion: OFFICE },
    ]);
    expect(await listed(server)).toEqual([
      { name: "Indiana Jones Collection", created: false },
      { name: "The Office", created: true },
    ]);
  });

  it("keeps a dismissal through catalog changes until it is restored", async () => {
    const { server, db, dependencies } = await startServer();

    expect(
      (
        await send(server, "POST", `${RECOMMENDATIONS}/dismissal`, {
          criterion: OFFICE,
        })
      ).status,
    ).toBe(204);
    await seedEpisodes(db, [["e3", 1, 3]], { withRoot: false });
    await dependencies.collectionMaintenance.request();

    expect(await listed(server)).toEqual([
      { name: "Indiana Jones Collection", created: false },
    ]);
    expect(await listed(server, true)).toEqual([
      { name: "The Office", created: false },
    ]);

    await send(server, "POST", `${RECOMMENDATIONS}/restoration`, {
      criterion: OFFICE,
    });

    expect(await listed(server)).toContainEqual({
      name: "The Office",
      created: false,
    });
  });

  it("does not bring back an accepted recommendation whose collection was deleted, but lists it as dismissed", async () => {
    const { server } = await startServer();
    const created = await accept(server, INDY, "automatic");

    await send(
      server,
      "DELETE",
      `/media-collections/${created.body.id as string}`,
    );

    expect(await listed(server)).toEqual([
      { name: "The Office", created: false },
    ]);
    expect(await listed(server, true)).toEqual([
      { name: "Indiana Jones Collection", created: false },
    ]);
  });

  it("saves a manual snapshot that never gains a later episode", async () => {
    const { server, db, dependencies } = await startServer();
    const created = await accept(server, OFFICE, "manual");

    await seedEpisodes(db, [["e3", 1, 3]], { withRoot: false });
    await dependencies.collectionMaintenance.request();

    expect(created.body).toMatchObject({
      maintenanceMode: "manual",
      criterion: null,
    });
    const members = await send(
      server,
      "GET",
      `/media-collections/${created.body.id as string}/items`,
    );
    expect(
      (members.body as { mediaItemId: string }[]).map((m) => m.mediaItemId),
    ).toEqual(["e1", "e2"]);
  });

  it("refuses to accept a genre or tag criterion", async () => {
    const { server } = await startServer();

    const genre = await accept(
      server,
      { kind: "genre", name: "Action" },
      "automatic",
    );

    expect(genre.status).toBe(400);
  });
});
