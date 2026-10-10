import { afterEach, describe, expect, it } from "vitest";

import { send, waitForScan } from "../../testing/api-requests.js";
import { rootFixture } from "../../testing/catalog-fixtures.js";
import {
  idOf,
  ALIEN_PATH as ALIEN,
  scanThroughRoutes,
  startEnrichmentServer,
} from "../../testing/enrichment-scan.js";
import { createBarrier } from "../../testing/test-barrier.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const RETRIES = "/metadata/lookup-retries";

describe("POST /metadata/lookup-retries", () => {
  it("starts a retry job that the root's scan routes read until it completes", async () => {
    const { server, tmdb } = await startEnrichmentServer({ files: [ALIEN] });
    tmdb.unreachable = true;
    await scanThroughRoutes(server);
    tmdb.unreachable = false;

    const started = await send(server, "POST", RETRIES, {
      scope: "failed",
      mediaRootId: rootFixture.id,
    });
    const finished = await waitForScan(server, rootFixture.id);

    expect(started).toMatchObject({
      status: 202,
      body: { kind: "retry", phase: "enriching", rootId: rootFixture.id },
    });
    expect(finished).toMatchObject({
      id: started.body.id,
      kind: "retry",
      phase: "completed",
      summary: { matchedCount: 1, discoveredCount: 0 },
    });
  });

  it("answers scan_in_progress while the root's scan runs", async () => {
    const { server, tmdb } = await startEnrichmentServer({ files: [ALIEN] });
    await scanThroughRoutes(server);
    const id = await idOf(server, ALIEN);
    const held = createBarrier();
    tmdb.holds.set("/3/search/movie", held);
    await send(server, "POST", RETRIES, { scope: "item", mediaItemId: id });
    await held.reached;

    const second = await send(server, "POST", RETRIES, {
      scope: "folder",
      mediaItemId: id,
    });
    held.release();
    await waitForScan(server, rootFixture.id);

    expect(second).toMatchObject({
      status: 409,
      body: {
        error: {
          code: "scan_in_progress",
          message: `The media root of item ${id} is already being scanned`,
        },
      },
    });
  });

  it("maps an unknown item, an unknown root, no key, and a bad body to errors", async () => {
    const { server } = await startEnrichmentServer({
      key: false,
      files: [ALIEN],
    });
    await scanThroughRoutes(server);
    const id = await idOf(server, ALIEN);

    const answers = await Promise.all([
      send(server, "POST", RETRIES, { scope: "item", mediaItemId: "nope" }),
      send(server, "POST", RETRIES, { scope: "failed", mediaRootId: "nope" }),
      send(server, "POST", RETRIES, { scope: "item", mediaItemId: id }),
      send(server, "POST", RETRIES, { scope: "root", mediaRootId: "x" }),
    ]);

    expect(
      answers.map(({ status, body }) => [status, body.error.code]),
    ).toEqual([
      [404, "media_item_not_found"],
      [404, "media_root_not_found"],
      [409, "tmdb_key_required"],
      [400, "invalid_request"],
    ]);
  });
});
