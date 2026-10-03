import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectionFixture,
  FIXTURE_TIME,
  rootFixture,
  titledItemFixture,
} from "../testing/catalog-fixtures.js";
import {
  channelFixture,
  programmingBlockFixture,
} from "../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../testing/test-environment.js";
import { MediaCollectionRepository } from "./media-collection-repository.js";
import { scriptedClock } from "../testing/record-sources.js";
import { ScheduleService } from "../schedules/schedule-service.js";

type Server = FastifyInstance;

const LATER = FIXTURE_TIME + 60_000;

afterEach(cleanUpTestEnvironment);

const pilot = titledItemFixture("pilot", { duration_ms: 1_320_000 });
const finale = titledItemFixture("finale", { status: "missing" });
const broken = titledItemFixture("broken", {
  status: "probe_failed",
  duration_ms: null,
  has_audio: null,
  probe_error: "ffprobe could not read the file",
});

// Boots the real composition over a fresh database seeded with one root and three items.
async function startServer(
  options: { ids?: string[]; times?: number[] } = {},
): Promise<Server> {
  // Deterministic sources so responses can be asserted exactly.
  const ids = [...(options.ids ?? ["collection-001", "collection-002"])];
  const now = scriptedClock(options.times ?? [FIXTURE_TIME]);
  const { server } = await startTestServer({
    seed: async (db) => {
      await db.insertInto("media_roots").values(rootFixture).execute();
      await db
        .insertInto("media_items")
        .values([pilot, finale, broken])
        .execute();
    },
    overrides: (db) => ({
      mediaCollections: new MediaCollectionRepository(db, {
        createId: () => ids.shift() ?? "collection-extra",
        now,
      }),
      // Membership changes take the schedule transaction's effective time.
      schedules: new ScheduleService(db, { now }),
    }),
  });
  return server;
}

function create(server: Server, payload: InjectOptions["payload"]) {
  return server.inject({ method: "POST", url: "/media-collections", payload });
}

function listMembers(server: Server, id: string) {
  return server.inject({
    method: "GET",
    url: `/media-collections/${id}/items`,
  });
}

function replaceMembers(
  server: Server,
  id: string,
  payload: InjectOptions["payload"],
) {
  return server.inject({
    method: "PUT",
    url: `/media-collections/${id}/items`,
    payload,
  });
}

const createdCollection = {
  id: "collection-001",
  name: "The Office",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("POST /media-collections", () => {
  it("creates an empty collection with a trimmed name", async () => {
    const server = await startServer();

    const response = await create(server, { name: "  The Office  " });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(createdCollection);
  });

  it("creates a collection with members in request order", async () => {
    const server = await startServer();

    await create(server, {
      name: "The Office",
      mediaItemIds: ["finale", "pilot"],
    });
    const members = await listMembers(server, "collection-001");

    expect(
      members
        .json()
        .map(({ mediaItemId }: { mediaItemId: string }) => mediaItemId),
    ).toEqual(["finale", "pilot"]);
  });

  it.each([
    ["an empty name", { name: "" }],
    ["a whitespace-only name", { name: "   " }],
    ["a missing name", {}],
    ["an unknown field", { name: "Movies", enabled: true }],
    ["a non-array membership", { name: "Movies", mediaItemIds: "pilot" }],
    ["a non-string member ID", { name: "Movies", mediaItemIds: [1] }],
  ])("rejects %s as invalid_request", async (_label, payload) => {
    const server = await startServer();

    const response = await create(server, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });

  it("rejects duplicate member IDs before anything is stored", async () => {
    const server = await startServer();

    const response = await create(server, {
      name: "Movies",
      mediaItemIds: ["pilot", "finale", "pilot"],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    expect(
      (
        await server.inject({ method: "GET", url: "/media-collections" })
      ).json(),
    ).toEqual([]);
  });

  it("names unknown media items and stores nothing", async () => {
    const server = await startServer();

    const response = await create(server, {
      name: "Movies",
      mediaItemIds: ["pilot", "ghost-1", "ghost-2"],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toEqual({
      code: "media_item_not_found",
      message: "Unknown media items: ghost-1, ghost-2",
    });
    expect(
      (
        await server.inject({ method: "GET", url: "/media-collections" })
      ).json(),
    ).toEqual([]);
  });
});

describe("GET /media-collections", () => {
  it("returns an empty list before any collection exists", async () => {
    const server = await startServer();

    const response = await server.inject({
      method: "GET",
      url: "/media-collections",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("orders collections by case-folded name", async () => {
    const server = await startServer({
      ids: ["collection-001", "collection-002", "collection-003"],
    });
    await create(server, { name: "halloween Movies" });
    await create(server, { name: "Anime" });
    await create(server, { name: "Holiday" });

    const response = await server.inject({
      method: "GET",
      url: "/media-collections",
    });

    expect(response.json().map(({ name }: { name: string }) => name)).toEqual([
      "Anime",
      "halloween Movies",
      "Holiday",
    ]);
  });
});

describe("GET /media-collections/:id", () => {
  it("returns the collection without its members", async () => {
    const server = await startServer();
    await create(server, { name: "The Office", mediaItemIds: ["pilot"] });

    const response = await server.inject({
      method: "GET",
      url: "/media-collections/collection-001",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(createdCollection);
  });

  it("returns media_collection_not_found for an unknown collection", async () => {
    const server = await startServer();

    const response = await server.inject({
      method: "GET",
      url: "/media-collections/unknown",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("media_collection_not_found");
  });
});

describe("PATCH /media-collections/:id", () => {
  it("renames the collection with a trimmed name and a fresh update time", async () => {
    const server = await startServer({ times: [FIXTURE_TIME, LATER] });
    await create(server, { name: "The Office" });

    const response = await server.inject({
      method: "PATCH",
      url: "/media-collections/collection-001",
      payload: { name: " The Office (US) " },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ...createdCollection,
      name: "The Office (US)",
      updatedAt: new Date(LATER).toISOString(),
    });
  });

  it.each([
    ["an empty name", { name: " " }],
    ["a missing name", {}],
    ["an unknown field", { name: "Movies", mediaItemIds: [] }],
  ])("rejects %s as invalid_request", async (_label, payload) => {
    const server = await startServer();
    await create(server, { name: "The Office" });

    const response = await server.inject({
      method: "PATCH",
      url: "/media-collections/collection-001",
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });

  it("returns media_collection_not_found for an unknown collection", async () => {
    const server = await startServer();

    const response = await server.inject({
      method: "PATCH",
      url: "/media-collections/unknown",
      payload: { name: "Movies" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("media_collection_not_found");
  });
});

describe("DELETE /media-collections/:id", () => {
  it("deletes the collection and keeps its media items", async () => {
    const server = await startServer();
    await create(server, { name: "The Office", mediaItemIds: ["pilot"] });

    const response = await server.inject({
      method: "DELETE",
      url: "/media-collections/collection-001",
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect((await listMembers(server, "collection-001")).statusCode).toBe(404);
    expect(
      (await server.inject({ method: "GET", url: "/media-items/pilot" }))
        .statusCode,
    ).toBe(200);
  });

  it("returns media_collection_in_use with the channels whose blocks use it", async () => {
    const { server } = await startTestServer({
      seed: async (db) => {
        await db
          .insertInto("media_collections")
          .values(collectionFixture)
          .execute();
        await db.insertInto("channels").values(channelFixture).execute();
        await db
          .insertInto("programming_blocks")
          .values(programmingBlockFixture)
          .execute();
      },
    });

    const response = await server.inject({
      method: "DELETE",
      url: `/media-collections/${collectionFixture.id}`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "media_collection_in_use",
        message: expect.stringContaining(collectionFixture.id),
        channelIds: [channelFixture.id],
      },
    });
    expect(
      (
        await server.inject({
          method: "GET",
          url: `/media-collections/${collectionFixture.id}`,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("returns media_collection_not_found for an unknown collection", async () => {
    const server = await startServer();

    const response = await server.inject({
      method: "DELETE",
      url: "/media-collections/unknown",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("media_collection_not_found");
  });
});

describe("GET /media-collections/:id/items", () => {
  it("returns an empty list for a collection without members", async () => {
    const server = await startServer();
    await create(server, { name: "The Office" });

    const response = await listMembers(server, "collection-001");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("summarizes each member so schedulability is visible in one request", async () => {
    const server = await startServer();
    await create(server, {
      name: "The Office",
      mediaItemIds: ["pilot", "finale", "broken"],
    });

    const response = await listMembers(server, "collection-001");

    expect(response.json()).toEqual([
      {
        position: 0,
        mediaItemId: "pilot",
        title: "pilot",
        status: "available",
        durationMs: 1_320_000,
      },
      {
        position: 1,
        mediaItemId: "finale",
        title: "finale",
        status: "missing",
        durationMs: 7_200_000,
      },
      {
        position: 2,
        mediaItemId: "broken",
        title: "broken",
        status: "probe_failed",
        durationMs: null,
      },
    ]);
  });

  it("returns media_collection_not_found for an unknown collection", async () => {
    const server = await startServer();

    const response = await listMembers(server, "unknown");

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("media_collection_not_found");
  });
});

describe("PUT /media-collections/:id/items", () => {
  it("reorders the full membership and returns it", async () => {
    const server = await startServer();
    await create(server, {
      name: "The Office",
      mediaItemIds: ["pilot", "finale", "broken"],
    });

    const response = await replaceMembers(server, "collection-001", {
      mediaItemIds: ["broken", "pilot"],
    });

    expect(response.statusCode).toBe(200);
    const expected = [
      { position: 0, mediaItemId: "broken" },
      { position: 1, mediaItemId: "pilot" },
    ];
    expect(response.json()).toMatchObject(expected);
    expect((await listMembers(server, "collection-001")).json()).toMatchObject(
      expected,
    );
  });

  it("marks the collection updated when its membership changes", async () => {
    const server = await startServer({ times: [FIXTURE_TIME, LATER] });
    await create(server, { name: "The Office", mediaItemIds: ["pilot"] });

    await replaceMembers(server, "collection-001", {
      mediaItemIds: ["finale"],
    });
    const response = await server.inject({
      method: "GET",
      url: "/media-collections/collection-001",
    });

    expect(response.json()).toEqual({
      ...createdCollection,
      updatedAt: new Date(LATER).toISOString(),
    });
  });

  it("empties the membership", async () => {
    const server = await startServer();
    await create(server, { name: "The Office", mediaItemIds: ["pilot"] });

    const response = await replaceMembers(server, "collection-001", {
      mediaItemIds: [],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("rejects duplicate member IDs and keeps the prior membership", async () => {
    const server = await startServer();
    await create(server, { name: "The Office", mediaItemIds: ["pilot"] });

    const response = await replaceMembers(server, "collection-001", {
      mediaItemIds: ["finale", "finale"],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    expect((await listMembers(server, "collection-001")).json()).toMatchObject([
      { mediaItemId: "pilot" },
    ]);
  });

  it("names unknown media items and keeps the prior membership", async () => {
    const server = await startServer();
    await create(server, { name: "The Office", mediaItemIds: ["pilot"] });

    const response = await replaceMembers(server, "collection-001", {
      mediaItemIds: ["finale", "ghost"],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toEqual({
      code: "media_item_not_found",
      message: "Unknown media items: ghost",
    });
    expect((await listMembers(server, "collection-001")).json()).toMatchObject([
      { mediaItemId: "pilot" },
    ]);
  });

  it.each([
    ["a missing membership", {}],
    ["an unknown field", { mediaItemIds: [], name: "Movies" }],
  ])("rejects %s as invalid_request", async (_label, payload) => {
    const server = await startServer();
    await create(server, { name: "The Office" });

    const response = await replaceMembers(server, "collection-001", payload);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });

  it("returns media_collection_not_found for an unknown collection", async () => {
    const server = await startServer();

    const response = await replaceMembers(server, "unknown", {
      mediaItemIds: ["pilot"],
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("media_collection_not_found");
  });
});
