import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { send } from "../../testing/api-requests.js";
import {
  CHOICE_DOCTOR_WHO_1963 as DOCTOR_WHO_1963,
  CHOICE_DOCTOR_WHO_2005 as DOCTOR_WHO_2005,
} from "../../testing/scan-metadata.js";
import {
  ROOT,
  idOf,
  scanThroughRoutes as scan,
  startEnrichmentServer,
} from "../../testing/enrichment-scan.js";
import { createBarrier } from "../../testing/test-barrier.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const THE_THING_1982 = 1091;

type Server = FastifyInstance;

// Lists items needing a choice, or every item, as `path below root: state`.
async function states(server: Server, needsChoice = false) {
  const { body } = await send(
    server,
    "GET",
    `/media-items?limit=200${needsChoice ? "&needsChoice=true" : ""}`,
  );
  const { items } = body as {
    items: { id: string; path: string; metadata: { matchState: string } }[];
  };
  return Object.fromEntries(
    items.map((item) => [
      item.path.slice(ROOT.length + 1).replaceAll("\\", "/"),
      item.metadata.matchState,
    ]),
  );
}

// Boots a server over `files` with both Doctor Who series known, then scans.
async function scanned(files: string[]) {
  const context = await startEnrichmentServer({ files });
  context.tmdb.series.push(DOCTOR_WHO_1963, DOCTOR_WHO_2005);
  await scan(context.server);
  return context;
}

describe("match choice routes", () => {
  it("lists one review step for a series folder, and choosing it resolves its episodes across season folders", async () => {
    const { server, db, tmdb } = await scanned([
      "Doctor Who/Season 1/s01e01.mkv",
      "Doctor Who/Season 2/s02e03.mkv",
      "The Thing/movie.mkv",
    ]);
    const first = await idOf(server, "Doctor Who/Season 1/s01e01.mkv");
    const callsAfterScan = tmdb.paths().length;

    await expect(
      send(server, "GET", "/metadata/match-reviews"),
    ).resolves.toEqual({
      status: 200,
      body: {
        steps: [
          { mediaItemId: first, title: "Doctor Who", itemCount: 2 },
          {
            mediaItemId: await idOf(server, "The Thing/movie.mkv"),
            title: "The Thing",
            itemCount: 1,
          },
        ],
      },
    });
    await expect(
      send(server, "GET", `/metadata/matches/${first}/candidates`),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        kind: "series",
        durationMs: expect.any(Number),
        candidates: [
          { tmdbId: 121, releaseDate: "1963-11-23" },
          { tmdbId: 57243, releaseDate: "2005-03-26" },
        ],
      },
    });
    // Opening the choice asks TMDB nothing; each runtime costs one call.
    expect(tmdb.paths()).toHaveLength(callsAfterScan);
    await expect(
      send(
        server,
        "GET",
        `/metadata/matches/${first}/candidates/57243/runtime`,
      ),
    ).resolves.toEqual({ status: 200, body: { runtimeMs: 45 * 60_000 } });
    expect(tmdb.paths().slice(callsAfterScan)).toEqual([
      "/3/tv/57243/season/1",
    ]);

    await expect(
      send(server, "POST", `/metadata/matches/${first}/choice`, {
        tmdbId: 57243,
      }),
    ).resolves.toEqual({ status: 200, body: { resolvedCount: 2 } });

    await expect(states(server)).resolves.toEqual({
      "Doctor Who/Season 1/s01e01.mkv": "matched",
      "Doctor Who/Season 2/s02e03.mkv": "matched",
      "The Thing/movie.mkv": "ambiguous",
    });
    const facts = await db
      .selectFrom("content_facts")
      .innerJoin(
        "metadata_matches",
        "metadata_matches.media_item_id",
        "content_facts.media_item_id",
      )
      .select(["series_tmdb_id", "season_number", "episode_number", "evidence"])
      .orderBy("season_number")
      .execute();
    expect(
      facts.map(({ evidence, ...fact }) => ({
        ...fact,
        chosen: JSON.parse(evidence).chosen,
      })),
    ).toEqual([
      {
        series_tmdb_id: 57243,
        season_number: 1,
        episode_number: 1,
        chosen: true,
      },
      {
        series_tmdb_id: 57243,
        season_number: 2,
        episode_number: 3,
        chosen: true,
      },
    ]);
  });

  it("filters the catalog listing to items needing a choice", async () => {
    const { server } = await scanned([
      "Alien (1979)/movie.mkv",
      "The Thing/movie.mkv",
    ]);

    await expect(states(server, true)).resolves.toEqual({
      "The Thing/movie.mkv": "ambiguous",
    });
  });

  it("leaves an episode the chosen series lacks ambiguous, and refuses that choice for it", async () => {
    const { server } = await scanned([
      "Doctor Who/Season 1/s01e01.mkv",
      "Doctor Who/Season 1/s01e30.mkv",
    ]);
    const lacking = await idOf(server, "Doctor Who/Season 1/s01e30.mkv");

    await expect(
      send(server, "POST", `/metadata/matches/${lacking}/choice`, {
        tmdbId: 57243,
      }),
    ).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "episode_not_in_series" } },
    });
    await expect(states(server)).resolves.toEqual({
      "Doctor Who/Season 1/s01e01.mkv": "ambiguous",
      "Doctor Who/Season 1/s01e30.mkv": "ambiguous",
    });

    const first = await idOf(server, "Doctor Who/Season 1/s01e01.mkv");
    await expect(
      send(server, "POST", `/metadata/matches/${first}/choice`, {
        tmdbId: 57243,
      }),
    ).resolves.toEqual({ status: 200, body: { resolvedCount: 1 } });
    await expect(states(server)).resolves.toEqual({
      "Doctor Who/Season 1/s01e01.mkv": "matched",
      "Doctor Who/Season 1/s01e30.mkv": "ambiguous",
    });
  });

  it("keeps a rejection on rescans until it is cleared, and then looks the item up again", async () => {
    const { server, tmdb } = await scanned(["The Thing/movie.mkv"]);
    const thing = await idOf(server, "The Thing/movie.mkv");

    await expect(
      send(server, "POST", `/metadata/matches/${thing}/rejection`),
    ).resolves.toEqual({ status: 200, body: { matchState: "rejected" } });
    const searches = tmdb.paths().length;
    await scan(server);
    await expect(states(server)).resolves.toEqual({
      "The Thing/movie.mkv": "rejected",
    });
    expect(tmdb.paths()).toHaveLength(searches);

    await expect(
      send(server, "DELETE", `/metadata/matches/${thing}/rejection`),
    ).resolves.toEqual({ status: 200, body: { matchState: "not_looked_up" } });
    await scan(server);
    await expect(states(server)).resolves.toEqual({
      "The Thing/movie.mkv": "ambiguous",
    });
  });

  it("rejects a matched movie, dropping its facts", async () => {
    const { server, db } = await scanned(["Alien (1979)/movie.mkv"]);
    const alien = await idOf(server, "Alien (1979)/movie.mkv");

    await send(server, "POST", `/metadata/matches/${alien}/rejection`);

    await expect(states(server)).resolves.toEqual({
      "Alien (1979)/movie.mkv": "rejected",
    });
    await expect(
      db.selectFrom("content_facts").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("changes nothing when the item is removed while TMDB answers the choice", async () => {
    const { server, db, tmdb } = await scanned(["The Thing/movie.mkv"]);
    const thing = await idOf(server, "The Thing/movie.mkv");
    const held = createBarrier();
    tmdb.holds.set(`/3/movie/${THE_THING_1982}`, held);

    const choice = send(server, "POST", `/metadata/matches/${thing}/choice`, {
      tmdbId: THE_THING_1982,
    });
    await held.reached;
    await expect(
      send(server, "POST", "/catalog-removals", {
        target: { mediaItemIds: [thing] },
      }),
    ).resolves.toMatchObject({ status: 200 });
    held.release();

    await expect(choice).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "media_item_not_found" } },
    });
    await expect(
      db.selectFrom("content_facts").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("changes nothing for an item removed while airing, which waits to be purged", async () => {
    const { server, db, tmdb } = await scanned(["The Thing/movie.mkv"]);
    const thing = await idOf(server, "The Thing/movie.mkv");
    const held = createBarrier();
    tmdb.holds.set(`/3/movie/${THE_THING_1982}`, held);

    const choice = send(server, "POST", `/metadata/matches/${thing}/choice`, {
      tmdbId: THE_THING_1982,
    });
    await held.reached;
    // An airing item keeps its rows after removal until the airing ends.
    await db
      .updateTable("media_items")
      .set({ removed_at: Date.now() })
      .where("id", "=", thing)
      .execute();
    held.release();

    await expect(choice).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "media_item_not_found" } },
    });
    await expect(
      db.selectFrom("metadata_matches").select("state").execute(),
    ).resolves.toEqual([{ state: "ambiguous" }]);
  });

  it("leaves a decision looked up again while TMDB answers the choice", async () => {
    const { server, db, tmdb } = await scanned(["The Thing/movie.mkv"]);
    const thing = await idOf(server, "The Thing/movie.mkv");
    const held = createBarrier();
    tmdb.holds.set(`/3/movie/${THE_THING_1982}`, held);

    const choice = send(server, "POST", `/metadata/matches/${thing}/choice`, {
      tmdbId: THE_THING_1982,
    });
    await held.reached;
    // A newer lookup, as a retry writes it, may offer other candidates.
    await db
      .updateTable("metadata_matches")
      .set({ looked_up_at: Date.now() })
      .where("media_item_id", "=", thing)
      .execute();
    held.release();

    await expect(choice).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "match_not_ambiguous" } },
    });
    await expect(
      db.selectFrom("content_facts").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("keeps a rejection made while TMDB answers the choice", async () => {
    const { server, tmdb } = await scanned(["The Thing/movie.mkv"]);
    const thing = await idOf(server, "The Thing/movie.mkv");
    const held = createBarrier();
    tmdb.holds.set(`/3/movie/${THE_THING_1982}`, held);

    const choice = send(server, "POST", `/metadata/matches/${thing}/choice`, {
      tmdbId: THE_THING_1982,
    });
    await held.reached;
    await send(server, "POST", `/metadata/matches/${thing}/rejection`);
    held.release();

    await expect(choice).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "match_not_ambiguous" } },
    });
    await expect(states(server)).resolves.toEqual({
      "The Thing/movie.mkv": "rejected",
    });
  });

  it("refuses a choice TMDB cannot answer, leaving the item to choose again", async () => {
    const { server, tmdb } = await scanned(["The Thing/movie.mkv"]);
    const thing = await idOf(server, "The Thing/movie.mkv");
    tmdb.unreachable = true;

    await expect(
      send(server, "POST", `/metadata/matches/${thing}/choice`, {
        tmdbId: THE_THING_1982,
      }),
    ).resolves.toMatchObject({
      status: 502,
      body: { error: { code: "tmdb_unreachable" } },
    });
    await expect(
      send(
        server,
        "GET",
        `/metadata/matches/${thing}/candidates/${THE_THING_1982}/runtime`,
      ),
    ).resolves.toEqual({ status: 200, body: { runtimeMs: null } });
    await expect(states(server)).resolves.toEqual({
      "The Thing/movie.mkv": "ambiguous",
    });
  });

  it.each([
    {
      name: "a candidate the item never offered",
      file: "The Thing/movie.mkv",
      request: ["POST", "choice", { tmdbId: 348 }],
      answer: [400, "candidate_not_offered"],
    },
    {
      name: "the runtime of a candidate the item never offered",
      file: "The Thing/movie.mkv",
      request: ["GET", "candidates/348/runtime"],
      answer: [400, "candidate_not_offered"],
    },
    {
      name: "a choice for a matched item",
      file: "Alien (1979)/movie.mkv",
      request: ["POST", "choice", { tmdbId: 348 }],
      answer: [409, "match_not_ambiguous"],
    },
    {
      name: "candidates of a matched item",
      file: "Alien (1979)/movie.mkv",
      request: ["GET", "candidates"],
      answer: [409, "match_not_ambiguous"],
    },
    {
      name: "rejecting an extra",
      file: "Alien (1979)/Featurettes/making-of.mkv",
      request: ["POST", "rejection"],
      answer: [409, "match_not_rejectable"],
    },
    {
      name: "clearing a rejection that was never made",
      file: "The Thing/movie.mkv",
      request: ["DELETE", "rejection"],
      answer: [409, "match_not_rejected"],
    },
  ] as const)("refuses $name", async ({ file, request, answer }) => {
    const { server } = await scanned([
      "Alien (1979)/movie.mkv",
      "Alien (1979)/Featurettes/making-of.mkv",
      "The Thing/movie.mkv",
    ]);
    const [method, action, body] = request;
    const [status, code] = answer;

    await expect(
      send(
        server,
        method,
        `/metadata/matches/${await idOf(server, file)}/${action}`,
        body,
      ),
    ).resolves.toMatchObject({ status, body: { error: { code } } });
  });

  it("refuses a choice without a TMDB key and an unknown item", async () => {
    const { server, db } = await scanned(["The Thing/movie.mkv"]);
    const thing = await idOf(server, "The Thing/movie.mkv");
    await db
      .updateTable("server_settings")
      .set({ tmdb_api_key: null })
      .execute();

    await expect(
      send(server, "POST", `/metadata/matches/${thing}/choice`, {
        tmdbId: THE_THING_1982,
      }),
    ).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "tmdb_key_required" } },
    });
    await expect(
      send(server, "POST", "/metadata/matches/nope/rejection"),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "media_item_not_found" } },
    });
  });
});
