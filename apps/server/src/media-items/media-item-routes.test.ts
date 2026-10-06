import type { FastifyInstance } from "fastify";
import type { Insertable } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { MediaItemTable } from "../database/schema/media-item-table.js";
import {
  animeRootFixture,
  FIXTURE_TIME,
  itemFixture,
  itemFixtureAt,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  startTestServer,
} from "../testing/test-environment.js";

type Server = FastifyInstance;

const LATER = FIXTURE_TIME + 60_000;

afterEach(cleanUpTestEnvironment);

// Boots the real composition over a fresh database seeded with both roots and the given items.
async function startServer(
  items: Insertable<MediaItemTable>[] = [],
  dataDirectory?: string,
): Promise<Server> {
  const { server } = await startTestServer({
    dataDirectory,
    seed: async (db) => {
      await db
        .insertInto("media_roots")
        .values([rootFixture, animeRootFixture])
        .execute();
      if (items.length > 0) {
        await db.insertInto("media_items").values(items).execute();
      }
    },
  });
  return server;
}

const firstFailure = itemFixtureAt(
  "item-first-failure",
  "/media/movies/broken.mkv",
  {
    status: "probe_failed",
    duration_ms: null,
    has_audio: null,
    probe_error: "ffprobe could not read the file",
  },
);

const laterFailure = itemFixtureAt(
  "item-later-failure",
  "/media/movies/corrupt.mkv",
  {
    status: "probe_failed",
    duration_ms: 1_500_000,
    has_audio: 0,
    probe_error: "ffprobe timed out",
    updated_at: LATER,
    last_seen_at: LATER,
    last_probed_at: LATER,
  },
);

const missing = itemFixtureAt("item-missing", "/media/movies/gone.mkv", {
  status: "missing",
  updated_at: LATER,
});

function list(server: Server, query = "") {
  return server.inject({ method: "GET", url: `/media-items${query}` });
}

function detail(server: Server, id: string) {
  return server.inject({ method: "GET", url: `/media-items/${id}` });
}

describe("GET /media-items", () => {
  it("returns an empty page before anything is scanned", async () => {
    const server = await startServer();

    const response = await list(server);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], total: 0 });
  });

  it("applies search, limit and offset while total counts every match", async () => {
    const server = await startServer([
      itemFixtureAt("item-a", "/media/movies/show-a.mkv"),
      itemFixtureAt("item-b", "/media/movies/show-b.mkv"),
      itemFixtureAt("item-c", "/media/movies/show-c.mkv"),
      itemFixtureAt("item-x", "/media/movies/other.mkv"),
    ]);

    const response = await list(server, "?q=%20SHOW%20&limit=1&offset=1");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: "item-b" }],
      total: 3,
    });
  });

  it.each([
    ["a zero limit", "?limit=0"],
    ["a limit above the page cap", "?limit=201"],
    ["a negative offset", "?offset=-1"],
    ["a non-numeric limit", "?limit=ten"],
    ["an unknown parameter", "?status=available"],
  ])("rejects %s as an invalid request", async (_case, query) => {
    const server = await startServer();

    const response = await list(server, query);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "invalid_request", message: expect.any(String) },
    });
  });

  it("orders by root path, then item path, then item ID", async () => {
    const server = await startServer([
      itemFixtureAt("item-001", "/media/movies/b.mkv"),
      itemFixtureAt("item-002", "/media/movies/a.mkv"),
      itemFixtureAt("item-004", "/media/anime/z.mkv", {
        media_root_id: animeRootFixture.id,
      }),
      itemFixtureAt("item-003", "/media/anime/z2.mkv", {
        media_root_id: animeRootFixture.id,
      }),
    ]);

    const response = await list(server);

    expect(response.json().items.map(({ id }: { id: string }) => id)).toEqual([
      "item-004",
      "item-003",
      "item-002",
      "item-001",
    ]);
  });
});

describe("GET /media-items/:id", () => {
  it("projects an available item with public fields only", async () => {
    const server = await startServer([itemFixture]);

    const response = await detail(server, "item-fixture-001");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: "item-fixture-001",
      mediaRootId: rootFixture.id,
      path: "/media/movies/example.mkv",
      title: "Example",
      durationMs: 7_200_000,
      hasAudio: true,
      hasVideo: true,
      status: "available",
      probeError: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      lastSeenAt: "2024-01-01T00:00:00.000Z",
      lastProbedAt: "2024-01-01T00:00:00.000Z",
    });
  });

  it("keeps history for a missing item while status stays authoritative", async () => {
    const server = await startServer([missing]);

    const response = await detail(server, "item-missing");

    expect(response.json()).toMatchObject({
      status: "missing",
      durationMs: 7_200_000,
      hasAudio: true,
      probeError: null,
      updatedAt: "2024-01-01T00:01:00.000Z",
    });
  });

  it("returns null metadata for a first-time probe failure", async () => {
    const server = await startServer([firstFailure]);

    const response = await detail(server, "item-first-failure");

    expect(response.json()).toMatchObject({
      status: "probe_failed",
      durationMs: null,
      hasAudio: null,
      probeError: "ffprobe could not read the file",
    });
  });

  it("retains last known metadata for a later probe failure", async () => {
    const server = await startServer([laterFailure]);

    const response = await detail(server, "item-later-failure");

    expect(response.json()).toMatchObject({
      status: "probe_failed",
      durationMs: 1_500_000,
      hasAudio: false,
      probeError: "ffprobe timed out",
      lastProbedAt: "2024-01-01T00:01:00.000Z",
    });
  });

  it("reports an unknown item with the structured error envelope", async () => {
    const server = await startServer();

    const response = await detail(server, "item-404");

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "media_item_not_found", message: expect.any(String) },
    });
  });
});

describe("media item persistence", () => {
  it("returns identical items after a server and database restart", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const first = await startServer(
      [itemFixture, missing, firstFailure, laterFailure],
      dataDirectory,
    );
    const before = await list(first);
    await first.close();

    const { server: second } = await startTestServer({ dataDirectory });
    const after = await list(second);

    expect(after.json().total).toBe(4);
    expect(after.json()).toEqual(before.json());
  });
});
