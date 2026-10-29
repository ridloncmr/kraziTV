import { afterEach, describe, expect, it } from "vitest";
import { expectRefusal } from "../../testing/refusal-details.js";

import { send } from "../../testing/api-requests.js";
import { seedEpisodes } from "../../testing/collection-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

/**
 * Boots a server cataloging three Office episodes, with an automatic Office
 * collection over them and a manual snapshot of the first.
 */
async function startServer() {
  const { server, db } = await startTestServer({
    seed: (db) =>
      seedEpisodes(db, [
        ["e1", 1, 1],
        ["e2", 1, 2],
        ["e3", 1, 3],
      ]),
  });
  const office = await send(server, "POST", "/media-collections", {
    name: "The Office",
    criterion: { kind: "series", tmdbId: 2316 },
  });
  const snapshot = await send(server, "POST", "/media-collections", {
    name: "Snapshot",
    mediaItemIds: ["e1"],
  });
  return {
    server,
    db,
    office: office.body.id as string,
    snapshot: snapshot.body.id as string,
  };
}

type Server = Awaited<ReturnType<typeof startServer>>["server"];

// Reads a collection's member IDs in position order.
async function members(server: Server, id: string) {
  const { body } = await send(server, "GET", `/media-collections/${id}/items`);
  return (body as { mediaItemId: string }[]).map((m) => m.mediaItemId);
}

// Reads a collection's exclusions as ID and whether each still qualifies.
async function exclusions(server: Server, id: string) {
  const { body } = await send(
    server,
    "GET",
    `/media-collections/${id}/exclusions`,
  );
  return (body as { mediaItemId: string; qualifies: boolean | null }[]).map(
    ({ mediaItemId, qualifies }) => ({ mediaItemId, qualifies }),
  );
}

describe("collection exclusion routes", () => {
  it("excludes a member at once, lists it as still qualifying, and restores it in order", async () => {
    const { server, office } = await startServer();
    const url = `/media-collections/${office}/exclusions/e2`;

    expect((await send(server, "PUT", url)).status).toBe(204);

    expect(await members(server, office)).toEqual(["e1", "e3"]);
    expect(await exclusions(server, office)).toEqual([
      { mediaItemId: "e2", qualifies: true },
    ]);

    expect((await send(server, "DELETE", url)).status).toBe(204);

    expect(await members(server, office)).toEqual(["e1", "e2", "e3"]);
    expect(await exclusions(server, office)).toEqual([]);
  });

  it("restores an item that no longer matches without including it", async () => {
    const { server, db, office } = await startServer();
    await send(server, "PUT", `/media-collections/${office}/exclusions/e3`);
    await db
      .updateTable("content_facts")
      .set({ series_tmdb_id: 8592 })
      .where("media_item_id", "=", "e3")
      .execute();
    expect(await exclusions(server, office)).toEqual([
      { mediaItemId: "e3", qualifies: false },
    ]);

    await send(server, "DELETE", `/media-collections/${office}/exclusions/e3`);

    expect(await members(server, office)).toEqual(["e1", "e2"]);
  });

  it("reports whether an excluded item matches as unknown while its TMDB data is expired", async () => {
    const { server, db, office } = await startServer();
    await send(server, "PUT", `/media-collections/${office}/exclusions/e3`);
    await db
      .insertInto("metadata_provider_refs")
      .values({
        media_item_id: "e3",
        provider: "tmdb",
        external_kind: "tv",
        external_id: 2316,
        fetched_at: 0,
        expired_at: 1,
      })
      .execute();

    expect(await exclusions(server, office)).toEqual([
      { mediaItemId: "e3", qualifies: null },
    ]);
  });

  it("refuses a manual collection, an unknown item, and an unknown collection", async () => {
    const { server, office, snapshot } = await startServer();

    const manual = await send(
      server,
      "PUT",
      `/media-collections/${snapshot}/exclusions/e1`,
    );
    const unknownItem = await send(
      server,
      "PUT",
      `/media-collections/${office}/exclusions/ghost`,
    );
    const unknownCollection = await send(
      server,
      "DELETE",
      "/media-collections/ghost/exclusions/e1",
    );

    expect(manual.status).toBe(409);
    expectRefusal(manual.body, "media_collection_manual", {
      mediaCollectionId: snapshot,
    });
    expect(unknownItem.status).toBe(400);
    expect(unknownItem.body.error.code).toBe("media_item_not_found");
    expect(unknownCollection.status).toBe(404);
    expectRefusal(unknownCollection.body, "media_collection_not_found", {
      mediaCollectionId: "ghost",
    });
    expect(await members(server, snapshot)).toEqual(["e1"]);
  });
});
