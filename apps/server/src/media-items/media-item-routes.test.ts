import type { FastifyInstance } from "fastify";
import type { Insertable } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { CatalogScanWriter } from "../catalog-scan/writer/catalog-scan-writer.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import { iso } from "../testing/api-requests.js";
import {
  animeRootFixture,
  FIXTURE_TIME,
  itemFixture,
  itemFixtureAt,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import {
  ALIEN,
  candidate,
  EPISODE_HINTS,
  FIREFLY_EPISODE,
  LOOKED_UP_AT,
  lookedUp,
  NO_CONTENT_METADATA,
  METADATA_PATHS as PATHS,
} from "../testing/metadata-match-fixtures.js";
import { sequentialIds } from "../testing/record-sources.js";
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

describe("POST /media-items/search", () => {
  it("pages the search without excluded IDs, counting only what remains", async () => {
    const server = await startServer([
      itemFixtureAt("item-a", "/media/movies/show-a.mkv"),
      itemFixtureAt("item-b", "/media/movies/show-b.mkv"),
      itemFixtureAt("item-c", "/media/movies/show-c.mkv"),
      itemFixtureAt("item-x", "/media/movies/other.mkv"),
    ]);

    const response = await server.inject({
      method: "POST",
      url: "/media-items/search",
      payload: { q: "show", limit: 1, offset: 1, excludeIds: ["item-a"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: "item-c" }],
      total: 2,
    });
  });

  it("rejects a page size above the cap", async () => {
    const server = await startServer();

    const response = await server.inject({
      method: "POST",
      url: "/media-items/search",
      payload: { limit: 201 },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /media-items/matches", () => {
  it("returns every non-excluded search match in catalog order with their count", async () => {
    const server = await startServer([
      itemFixtureAt("item-b", "/media/movies/show-b.mkv"),
      itemFixtureAt("item-a", "/media/movies/show-a.mkv"),
      itemFixtureAt("item-x", "/media/movies/other.mkv"),
    ]);

    const response = await server.inject({
      method: "POST",
      url: "/media-items/matches",
      payload: { q: "show", excludeIds: ["item-b"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: "item-a" }],
      total: 1,
    });
  });

  it("rejects paging parameters because it never pages", async () => {
    const server = await startServer();

    const response = await server.inject({
      method: "POST",
      url: "/media-items/matches",
      payload: { limit: 10 },
    });

    expect(response.statusCode).toBe(400);
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
      metadata: NO_CONTENT_METADATA,
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

describe("content metadata", () => {
  /**
   * Boots a server whose catalog the real scan writer committed, so the
   * listing reads the rows a scan writes rather than hand-built ones. A
   * rejection has no writer yet, so it is set directly.
   */
  async function startWithMetadata() {
    const { server } = await startTestServer({
      seed: async (db) => {
        await db.insertInto("media_roots").values(rootFixture).execute();
        const query = { title: "Fixture" };
        await new CatalogScanWriter(db, {
          createId: sequentialIds("item"),
        }).commit({
          rootId: rootFixture.id,
          scannedAt: LOOKED_UP_AT,
          candidates: Object.values(PATHS).map(candidate),
          metadataMatches: [
            lookedUp(PATHS.movie, ALIEN),
            lookedUp(PATHS.episode, FIREFLY_EPISODE, EPISODE_HINTS),
            lookedUp(PATHS.ambiguous, {
              kind: "ambiguous",
              query,
              candidates: [{ id: 1091, title: "The Thing" }],
            }),
            lookedUp(PATHS.unmatched, { kind: "unmatched", query }),
            lookedUp(PATHS.failed, {
              kind: "failed",
              query,
              reason: "TMDB answered HTTP 503",
            }),
            {
              kind: "extra",
              pathKey: PATHS.extra,
              hints: { extra: true, strength: "weak" },
            },
            lookedUp(PATHS.rejected, { kind: "unmatched", query }),
          ],
        });
        await db
          .updateTable("metadata_matches")
          .set({ state: "rejected" })
          .where("media_item_id", "=", (eb) =>
            eb
              .selectFrom("media_items")
              .select("id")
              .where("path_key", "=", PATHS.rejected),
          )
          .execute();
      },
    });
    return server;
  }

  it("lists each item's match state and accepted TMDB facts", async () => {
    const server = await startWithMetadata();

    const response = await list(server);

    expect(response.statusCode).toBe(200);
    const metadataAt = new Map(
      response
        .json<{ items: { path: string; metadata: unknown }[] }>()
        .items.map((item) => [item.path, item.metadata]),
    );
    expect(Object.fromEntries(metadataAt)).toEqual({
      [PATHS.movie]: {
        ...NO_CONTENT_METADATA,
        matchState: "matched",
        title: "Alien",
        releaseDate: "1979-05-25",
        genres: ["Horror", "Science Fiction"],
        franchiseName: "Alien Collection",
        description: "In space…",
        posterPath: "/alien.jpg",
        refreshedAt: iso(LOOKED_UP_AT),
      },
      [PATHS.episode]: {
        ...NO_CONTENT_METADATA,
        matchState: "matched",
        title: "Safe / Our Mrs. Reynolds",
        seriesName: "Firefly",
        seasonNumber: 1,
        episodeNumber: 5,
        lastEpisodeNumber: 6,
        releaseDate: "2002-10-18",
        genres: ["Drama", "Sci-Fi & Fantasy"],
        description: "Simon is kidnapped.",
        posterPath: "/firefly.jpg",
        refreshedAt: iso(LOOKED_UP_AT),
      },
      [PATHS.ambiguous]: { ...NO_CONTENT_METADATA, matchState: "ambiguous" },
      [PATHS.unmatched]: { ...NO_CONTENT_METADATA, matchState: "unmatched" },
      [PATHS.failed]: {
        ...NO_CONTENT_METADATA,
        matchState: "unmatched",
        lookupError: "TMDB answered HTTP 503",
      },
      [PATHS.extra]: { ...NO_CONTENT_METADATA, matchState: "extra" },
      [PATHS.rejected]: { ...NO_CONTENT_METADATA, matchState: "rejected" },
      [PATHS.notLookedUp]: {
        ...NO_CONTENT_METADATA,
        matchState: "not_looked_up",
      },
    });
  });

  it("returns the same metadata for one item as the listing", async () => {
    const server = await startWithMetadata();
    const listed = (
      await list(server, `?q=${encodeURIComponent("Alien (1979)/alien")}`)
    ).json<{ items: { id: string; metadata: unknown }[] }>().items;

    expect(listed).toHaveLength(1);
    const [item] = listed;
    expect((await detail(server, item.id)).json()).toMatchObject({
      metadata: item.metadata,
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
