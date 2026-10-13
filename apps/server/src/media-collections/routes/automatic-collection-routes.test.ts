import { afterEach, describe, expect, it } from "vitest";

import { createChannel, send, windowUrl } from "../../testing/api-requests.js";
import {
  FIXTURE_TIME,
  rootFixture,
  titledItemFixture,
} from "../../testing/catalog-fixtures.js";
import { episodeFacts, movieFacts } from "../../testing/collection-fixtures.js";
import { correctionRow } from "../../testing/metadata-match-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const OFFICE = { kind: "series", tmdbId: 2316 } as const;
const INDIANA_JONES_COLLECTION = {
  tmdbId: 84,
  name: "Indiana Jones Collection",
};

/**
 * Boots a server whose catalog holds three Office episodes stored out of
 * episode order, one of them missing, a corrected and a removed Office
 * episode that never match, one Parks episode, two Indiana Jones movies
 * stored out of release order, and Alien.
 */
async function startServer() {
  const { server, db } = await startTestServer({
    seed: async (db) => {
      await db.insertInto("media_roots").values(rootFixture).execute();
      await db
        .insertInto("media_items")
        .values([
          titledItemFixture("office-3", { status: "missing" }),
          titledItemFixture("office-1"),
          titledItemFixture("office-2"),
          titledItemFixture("office-corrected"),
          titledItemFixture("office-removed", { removed_at: FIXTURE_TIME }),
          titledItemFixture("parks-1"),
          titledItemFixture("crusade"),
          titledItemFixture("raiders"),
          titledItemFixture("alien"),
        ])
        .execute();
      await db
        .insertInto("content_facts")
        .values([
          episodeFacts("office-3", 2316, 1, 3),
          episodeFacts("office-1", 2316, 1, 1),
          episodeFacts("office-2", 2316, 1, 2),
          episodeFacts("office-corrected", 2316, 1, 4),
          // A stale name only a removed item holds never names the series.
          {
            ...episodeFacts("office-removed", 2316, 1, 5),
            series_name: "Zzz Stale Office",
          },
          { ...episodeFacts("parks-1", 8592, 1, 1), series_name: "Parks" },
          movieFacts("crusade", INDIANA_JONES_COLLECTION, "1989-05-24"),
          movieFacts("raiders", INDIANA_JONES_COLLECTION, "1981-06-12"),
          movieFacts(
            "alien",
            { tmdbId: 8091, name: "Alien Collection" },
            "1979-05-25",
          ),
        ])
        .execute();
      await db
        .insertInto("metadata_corrections")
        .values(correctionRow("office-corrected", { series_name: "Office" }))
        .execute();
    },
  });
  return { server, db };
}

// Reads the member IDs of a member list response in position order.
function ids(members: unknown): string[] {
  return (members as { mediaItemId: string }[]).map(
    (member) => member.mediaItemId,
  );
}

describe("GET /media-collections/series", () => {
  it("lists cataloged series by name with the items each would include", async () => {
    const { server } = await startServer();

    const response = await send(server, "GET", "/media-collections/series");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { tmdbId: 8592, name: "Parks", itemCount: 1 },
      { tmdbId: 2316, name: "The Office", itemCount: 3 },
    ]);
  });
});

describe("GET /media-collections/franchises", () => {
  it("lists cataloged franchises by name with the movies each would include", async () => {
    const { server } = await startServer();

    const response = await send(server, "GET", "/media-collections/franchises");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { tmdbId: 8091, name: "Alien Collection", itemCount: 1 },
      { tmdbId: 84, name: "Indiana Jones Collection", itemCount: 2 },
    ]);
  });
});

describe("automatic franchise collections", () => {
  it("creates a franchise collection in release order, named by its franchise", async () => {
    const { server } = await startServer();
    const criterion = { kind: "franchise", tmdbId: 84 };

    const preview = await send(server, "POST", "/media-collections/previews", {
      criterion,
    });
    const created = await send(server, "POST", "/media-collections", {
      name: "Indy",
      criterion,
    });

    expect(ids(preview.body)).toEqual(["raiders", "crusade"]);
    expect(created.body).toMatchObject({
      maintenanceMode: "automatic",
      criterion,
      criterionLabel: "Indiana Jones Collection",
    });
    expect(
      ids(
        (
          await send(
            server,
            "GET",
            `/media-collections/${created.body.id}/items`,
          )
        ).body,
      ),
    ).toEqual(["raiders", "crusade"]);
  });
});

describe("automatic series collections", () => {
  it("creates the membership its preview showed, in episode order", async () => {
    const { server } = await startServer();

    const preview = await send(server, "POST", "/media-collections/previews", {
      criterion: OFFICE,
    });
    const created = await send(server, "POST", "/media-collections", {
      name: "The Office",
      criterion: OFFICE,
    });
    const members = await send(
      server,
      "GET",
      `/media-collections/${created.body.id}/items`,
    );

    expect(preview.status).toBe(200);
    expect(ids(preview.body)).toEqual(["office-1", "office-2", "office-3"]);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "The Office",
      maintenanceMode: "automatic",
      criterion: OFFICE,
      criterionLabel: "The Office",
      maintainedAt: expect.any(String),
      maintenanceError: null,
      maintenanceIncomplete: false,
    });
    expect(members.body).toEqual(preview.body);
  });

  it("counts its members, and missing ones, in the listing", async () => {
    const { server } = await startServer();
    await send(server, "POST", "/media-collections", {
      name: "The Office",
      criterion: OFFICE,
    });

    const listing = await send(server, "GET", "/media-collections");

    expect(listing.body).toMatchObject([
      { name: "The Office", memberCount: 3, missingCount: 1 },
    ]);
  });

  it("reports why its latest maintenance failed, keeping the time it last succeeded", async () => {
    const { server, db } = await startServer();
    const created = await send(server, "POST", "/media-collections", {
      name: "The Office",
      criterion: OFFICE,
    });
    await db
      .updateTable("media_collections")
      .set({ maintenance_error: "disk I/O error" })
      .execute();

    const listing = await send(server, "GET", "/media-collections");

    expect(listing.body).toMatchObject([
      {
        maintainedAt: created.body.maintainedAt,
        maintenanceError: "disk I/O error",
      },
    ]);
  });

  it("refuses a direct membership replacement and keeps its members", async () => {
    const { server } = await startServer();
    const created = await send(server, "POST", "/media-collections", {
      name: "The Office",
      criterion: OFFICE,
    });
    const itemsUrl = `/media-collections/${created.body.id}/items`;

    const replaced = await send(server, "PUT", itemsUrl, {
      mediaItemIds: ["parks-1"],
    });

    expect(replaced.status).toBe(409);
    expect(replaced.body.error.code).toBe("media_collection_automatic");
    expect(ids((await send(server, "GET", itemsUrl)).body)).toEqual([
      "office-1",
      "office-2",
      "office-3",
    ]);
  });

  it("is an ordinary source a programming block can draw from", async () => {
    const { server } = await startServer();
    const created = await send(server, "POST", "/media-collections", {
      name: "The Office",
      criterion: OFFICE,
    });
    const channel = await createChannel(server, {
      number: "69",
      name: "Office TV",
    });
    const channelUrl = `/channels/${channel.json().id}`;

    const block = await send(
      server,
      "POST",
      `${channelUrl}/programming-blocks`,
      {
        source: {
          kind: "collection",
          mediaCollectionId: created.body.id,
          playbackMode: "chronological",
        },
      },
    );
    const now = Date.now();
    const schedule = await send(
      server,
      "GET",
      windowUrl(`${channelUrl}/schedule`, now, now + 60_000),
    );

    expect(block.status).toBe(201);
    expect(schedule.body.entries[0].mediaItemId).toBe("office-1");
  });

  it.each([
    [
      "both members and a criterion",
      { name: "Mixed", mediaItemIds: ["parks-1"], criterion: OFFICE },
    ],
    [
      "an unknown criterion kind",
      { name: "Odd", criterion: { kind: "actor" } },
    ],
    [
      "a criterion with extra fields",
      { name: "Odd", criterion: { ...OFFICE, name: "The Office" } },
    ],
  ])("rejects %s as invalid_request", async (_, payload) => {
    const { server } = await startServer();

    const response = await send(server, "POST", "/media-collections", payload);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });
});
