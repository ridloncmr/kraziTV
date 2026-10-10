import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { send, waitForScan } from "../../testing/api-requests.js";
import { rootFixture } from "../../testing/catalog-fixtures.js";
import {
  ROOT,
  correct,
  idOf,
  metadataOf,
  scanThroughRoutes as scan,
} from "../../testing/enrichment-scan.js";
import { createBarrier } from "../../testing/test-barrier.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

import {
  MINUTE,
  TRACKS,
  OTHER_SEASON,
  EPISODE,
  SOME_SHOW,
  ACCEPTED,
  scanned,
  mappingOf,
  apply,
} from "../../testing/track-mapping-fixtures.js";

afterEach(cleanUpTestEnvironment);

describe("track mapping routes", () => {
  it("lists a season's tracks across its discs, in disc-then-track order", async () => {
    const { server } = await scanned();

    const { status, body } = await send(
      server,
      "GET",
      await mappingOf(server, TRACKS.third),
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ series: "Some Show", season: 1 });
    const { tracks } = body as {
      tracks: { path: string; disc: number; track: number }[];
    };
    expect(tracks.map((track) => track.path)).toEqual(
      Object.values(TRACKS).map((file) => join(ROOT, file)),
    );
    expect(tracks[4]).toMatchObject({
      disc: 2,
      track: 0,
      durationMs: 45 * MINUTE,
    });
  });

  it("searches TMDB's series and proposes rows with the season's runtimes", async () => {
    const { server } = await scanned();

    await expect(
      send(server, "GET", "/metadata/series-search?query=some%20show"),
    ).resolves.toEqual({
      status: 200,
      body: {
        candidates: [
          {
            tmdbId: SOME_SHOW.id,
            title: "Some Show",
            releaseDate: "2010-01-04",
            posterPath: `/poster-${SOME_SHOW.id}.jpg`,
          },
        ],
      },
    });
    const { status, body } = await send(
      server,
      "GET",
      `${await mappingOf(server, TRACKS.first)}/proposal?tmdbSeriesId=${SOME_SHOW.id}&season=1`,
    );

    expect(status).toBe(200);
    const proposal = body as {
      rows: { mediaItemId: string; episodeNumber: number | null }[];
      episodes: { number: number; runtimeMs: number | null }[];
    };
    expect(proposal.rows).toEqual(
      await Promise.all(
        ACCEPTED.map(async ([file, episodeNumber]) => ({
          mediaItemId: await idOf(server, file),
          episodeNumber,
        })),
      ),
    );
    expect(proposal.episodes).toHaveLength(4);
    expect(proposal.episodes[0]).toEqual({
      number: 1,
      title: "Some Show 1x1",
      runtimeMs: 44 * MINUTE,
    });
  });

  it("stores mapped tracks as chosen matches with corrections, and skipped ones as extras, through a rescan and a retry", async () => {
    const { server, tmdb } = await scanned();

    await expect(apply(server, ACCEPTED)).resolves.toEqual({
      status: 200,
      body: { mappedCount: 3, extraCount: 2, goneCount: 0 },
    });
    const expected = async () => {
      await expect(
        metadataOf(server, await idOf(server, TRACKS.third)),
      ).resolves.toMatchObject({
        matchState: "matched",
        title: "Some Show 1x3",
        seriesName: "Some Show",
        seasonNumber: 1,
        episodeNumber: 3,
        correctedFields: ["seriesName", "seasonNumber", "episodeNumber"],
      });
      await expect(
        metadataOf(server, await idOf(server, TRACKS.playAll)),
      ).resolves.toMatchObject({ matchState: "extra", correctedFields: [] });
    };
    await expected();

    const callsBefore = tmdb.paths().length;
    await scan(server);
    // Every track is settled, so the rescan asks TMDB nothing.
    expect(tmdb.paths()).toHaveLength(callsBefore);
    await expected();

    await send(server, "POST", "/metadata/lookup-retries", {
      scope: "folder",
      mediaItemId: await idOf(server, TRACKS.first),
    });
    await waitForScan(server, rootFixture.id);
    await expected();
  });

  it("replaces a track's corrected title but keeps its tags", async () => {
    const { server } = await scanned();
    const first = await idOf(server, TRACKS.first);
    const short = await idOf(server, TRACKS.short);
    await correct(server, first, { title: "Pilot", tags: ["cozy"] });
    await correct(server, short, { episodeNumber: 7, tags: ["bonus"] });

    await apply(server, ACCEPTED);

    await expect(metadataOf(server, first)).resolves.toMatchObject({
      title: "Some Show 1x1",
      tags: ["cozy"],
    });
    await expect(metadataOf(server, short)).resolves.toMatchObject({
      matchState: "extra",
      episodeNumber: null,
      tags: ["bonus"],
      correctedFields: [],
    });
  });

  it("leaves out a track removed while the dialog was open", async () => {
    const { server, db } = await scanned();
    await db
      .updateTable("media_items")
      .set({ removed_at: 1 })
      .where("path", "=", join(ROOT, TRACKS.third))
      .execute();
    // The dialog read the folder before the removal, so it still sends the row.
    const removedId = (
      await db
        .selectFrom("media_items")
        .select("id")
        .where("path", "=", join(ROOT, TRACKS.third))
        .executeTakeFirstOrThrow()
    ).id;

    const applied = await send(
      server,
      "POST",
      await mappingOf(server, TRACKS.first),
      {
        tmdbSeriesId: SOME_SHOW.id,
        season: 1,
        rows: [
          { mediaItemId: await idOf(server, TRACKS.first), episodeNumber: 1 },
          { mediaItemId: removedId, episodeNumber: 3 },
        ],
      },
    );

    expect(applied).toEqual({
      status: 200,
      body: { mappedCount: 1, extraCount: 0, goneCount: 1 },
    });
    const facts = await db
      .selectFrom("metadata_matches")
      .select("media_item_id")
      .where("media_item_id", "=", removedId)
      .execute();
    expect(facts).toEqual([]);
  });

  it("leaves out a track removed while Apply waited on TMDB", async () => {
    const { server, db, tmdb } = await scanned();
    const third = await idOf(server, TRACKS.third);
    const held = createBarrier();
    tmdb.holds.set(`/3/tv/${SOME_SHOW.id}/season/1`, held);

    const applied = apply(server, ACCEPTED);
    await held.reached;
    await db
      .updateTable("media_items")
      .set({ removed_at: 1 })
      .where("id", "=", third)
      .execute();
    held.release();

    await expect(applied).resolves.toEqual({
      status: 200,
      body: { mappedCount: 2, extraCount: 2, goneCount: 1 },
    });
    const rows = await db
      .selectFrom("metadata_corrections")
      .select("media_item_id")
      .where("media_item_id", "=", third)
      .execute();
    expect(rows).toEqual([]);
  });

  it.each(["correction", "rejection"] as const)(
    "preserves a newer %s while Apply waits on TMDB",
    async (decision) => {
      const { server, tmdb } = await scanned();
      await apply(server, ACCEPTED);
      const first = await idOf(server, TRACKS.first);
      const held = createBarrier();
      tmdb.holds.set(`/3/tv/${SOME_SHOW.id}/season/1`, held);
      const pending = apply(
        server,
        ACCEPTED.map(([file, episode]): [string, number | null] => [
          file,
          file === TRACKS.second ? 4 : episode,
        ]),
      );
      await held.reached;
      try {
        if (decision === "correction") {
          await correct(server, first, { title: "Newer title" });
        } else {
          await send(server, "POST", `/metadata/matches/${first}/rejection`);
        }
      } finally {
        held.release();
      }
      await expect(pending).resolves.toMatchObject({
        status: 409,
        body: { error: { code: "mapping_changed" } },
      });
      await expect(metadataOf(server, first)).resolves.toMatchObject(
        decision === "correction"
          ? { title: "Newer title" }
          : { matchState: "rejected" },
      );
      await expect(
        metadataOf(server, await idOf(server, TRACKS.second)),
      ).resolves.toMatchObject({ episodeNumber: 2 });
    },
  );

  it("refuses a row outside the folder, a file that is no disc track, and a season TMDB lacks", async () => {
    const { server } = await scanned();

    await expect(apply(server, [[OTHER_SEASON, 1]])).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "track_not_in_folder" } },
    });
    await expect(
      send(server, "GET", await mappingOf(server, EPISODE)),
    ).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "not_disc_track" } },
    });
    await expect(
      send(
        server,
        "GET",
        `${await mappingOf(server, TRACKS.first)}/proposal?tmdbSeriesId=${SOME_SHOW.id}&season=5`,
      ),
    ).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "season_not_in_series" } },
    });
    await expect(apply(server, [[TRACKS.first, 9]])).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "episode_not_in_series" } },
    });
  });

  it("refuses every route without a TMDB key", async () => {
    const { server } = await scanned({ key: false });
    const mapping = await mappingOf(server, TRACKS.first);

    for (const [method, path] of [
      ["GET", mapping],
      ["GET", "/metadata/series-search?query=Some"],
      ["GET", `${mapping}/proposal?tmdbSeriesId=${SOME_SHOW.id}&season=1`],
    ] as const) {
      await expect(send(server, method, path)).resolves.toMatchObject({
        status: 409,
        body: { error: { code: "tmdb_key_required" } },
      });
    }
    await expect(apply(server, ACCEPTED)).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "tmdb_key_required" } },
    });
  });
});
