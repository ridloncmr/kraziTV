import {
  ALIEN,
  EPISODE_HINTS,
  FIREFLY_EPISODE,
  HINTS,
  LOOKED_UP_AT,
  candidate,
  lookedUp,
} from "../../testing/metadata-match-fixtures.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  FIXTURE_TIME,
  itemFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { sequentialIds } from "../../testing/record-sources.js";
import type { MetadataMatchRecord } from "../contracts.js";
import { CatalogScanWriter } from "./catalog-scan-writer.js";

const SCANNED_AT = FIXTURE_TIME + 60_000;

afterEach(cleanUpTestEnvironment);

// Opens a migrated database holding the fixture root and its one item.
async function setup() {
  const { db } = await openTestDatabase();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_items").values(itemFixture).execute();
  return {
    db,
    writer: new CatalogScanWriter(db, { createId: sequentialIds("item") }),
  };
}

type Db = Awaited<ReturnType<typeof setup>>["db"];

// Commits one generation holding the fixture item and these records.
async function commit(
  writer: CatalogScanWriter,
  metadataMatches: MetadataMatchRecord[],
  pathKeys = [itemFixture.path_key],
) {
  await writer.commit({
    rootId: rootFixture.id,
    scannedAt: SCANNED_AT,
    candidates: pathKeys.map(candidate),
    metadataMatches,
  });
}

async function metadata(db: Db) {
  return {
    matches: await db
      .selectFrom("metadata_matches")
      .selectAll()
      .orderBy("media_item_id")
      .execute(),
    facts: await db.selectFrom("content_facts").selectAll().execute(),
    refs: await db.selectFrom("metadata_provider_refs").selectAll().execute(),
    candidates: await db
      .selectFrom("metadata_match_candidates")
      .selectAll()
      .orderBy("position")
      .execute(),
  };
}

describe("CatalogScanWriter metadata matches", () => {
  it("writes a match with its facts, TMDB reference, evidence, and probed duration", async () => {
    const { db, writer } = await setup();

    await commit(writer, [lookedUp(itemFixture.path_key, ALIEN)]);

    await expect(metadata(db)).resolves.toEqual({
      matches: [
        {
          media_item_id: itemFixture.id,
          state: "matched",
          extra: 0,
          lookup_error: null,
          looked_up_at: LOOKED_UP_AT,
          evidence: JSON.stringify({
            hints: HINTS,
            query: { title: "Alien", year: 1979 },
          }),
          matched_duration_ms: 6_000_000,
        },
      ],
      facts: [
        {
          media_item_id: itemFixture.id,
          content_type: "movie",
          title: "Alien",
          release_date: "1979-05-25",
          genres: '["Horror","Science Fiction"]',
          franchise_tmdb_id: 8091,
          franchise_name: "Alien Collection",
          description: "In space…",
          poster_path: "/alien.jpg",
          series_tmdb_id: null,
          series_name: null,
          season_number: null,
          episode_number: null,
          last_episode_number: null,
        },
      ],
      refs: [
        {
          media_item_id: itemFixture.id,
          provider: "tmdb",
          external_kind: "movie",
          external_id: 348,
          fetched_at: LOOKED_UP_AT,
        },
      ],
      candidates: [],
    });
  });

  it("writes an episode's series, season, and episode range with its series as the reference", async () => {
    const { db, writer } = await setup();

    await commit(writer, [
      lookedUp(itemFixture.path_key, FIREFLY_EPISODE, EPISODE_HINTS),
    ]);

    const written = await metadata(db);
    expect(written.matches).toMatchObject([
      {
        state: "matched",
        evidence: JSON.stringify({
          hints: EPISODE_HINTS,
          query: { title: "Firefly" },
        }),
        matched_duration_ms: 6_000_000,
      },
    ]);
    expect(written.facts).toEqual([
      {
        media_item_id: itemFixture.id,
        content_type: "episode",
        title: "Safe / Our Mrs. Reynolds",
        release_date: "2002-10-18",
        genres: '["Drama","Sci-Fi & Fantasy"]',
        franchise_tmdb_id: null,
        franchise_name: null,
        description: "Simon is kidnapped.",
        poster_path: "/firefly.jpg",
        series_tmdb_id: 1437,
        series_name: "Firefly",
        season_number: 1,
        episode_number: 5,
        last_episode_number: 6,
      },
    ]);
    expect(written.refs).toEqual([
      {
        media_item_id: itemFixture.id,
        provider: "tmdb",
        external_kind: "tv",
        external_id: 1437,
        fetched_at: LOOKED_UP_AT,
      },
    ]);
  });

  it("leaves a multi-episode title unknown when TMDB has not named every part", async () => {
    const { db, writer } = await setup();
    const untitledFirst = {
      ...FIREFLY_EPISODE,
      episodes: [{ number: 5 }, { number: 6, title: "Our Mrs. Reynolds" }],
    };

    await commit(writer, [
      lookedUp(itemFixture.path_key, untitledFirst, EPISODE_HINTS),
    ]);

    await expect(
      db.selectFrom("content_facts").select("title").execute(),
    ).resolves.toEqual([{ title: null }]);
  });

  it("writes an ambiguous item's candidates in TMDB's order", async () => {
    const { db, writer } = await setup();

    await commit(writer, [
      lookedUp(itemFixture.path_key, {
        kind: "ambiguous",
        query: { title: "The Thing" },
        candidates: [
          {
            id: 1091,
            title: "The Thing",
            releaseDate: "1982-06-25",
            posterPath: "/1982.jpg",
          },
          { id: 60935, title: "The Thing" },
        ],
      }),
    ]);

    const written = await metadata(db);
    expect(written.matches).toMatchObject([
      { state: "ambiguous", matched_duration_ms: null, lookup_error: null },
    ]);
    expect(written.candidates).toEqual([
      {
        media_item_id: itemFixture.id,
        position: 0,
        tmdb_id: 1091,
        title: "The Thing",
        release_date: "1982-06-25",
        poster_path: "/1982.jpg",
      },
      {
        media_item_id: itemFixture.id,
        position: 1,
        tmdb_id: 60935,
        title: "The Thing",
        release_date: null,
        poster_path: null,
      },
    ]);
    expect(written.facts).toEqual([]);
  });

  it("records a failed lookup as an unmatched item with its error", async () => {
    const { db, writer } = await setup();

    await commit(writer, [
      lookedUp(itemFixture.path_key, {
        kind: "failed",
        query: { title: "Alien" },
        reason: "TMDB answered HTTP 503",
      }),
    ]);

    await expect(metadata(db)).resolves.toMatchObject({
      matches: [{ state: "unmatched", lookup_error: "TMDB answered HTTP 503" }],
      facts: [],
    });
  });

  it("records an extra without a lookup, and a new item's match under its new ID", async () => {
    const { db, writer } = await setup();
    const extraKey = "/media/movies/Alien (1979)/Featurettes/making-of.mkv";

    await commit(
      writer,
      [
        {
          kind: "extra",
          pathKey: extraKey,
          hints: { extra: true, strength: "weak" },
        },
      ],
      [itemFixture.path_key, extraKey],
    );

    await expect(metadata(db)).resolves.toMatchObject({
      matches: [
        {
          media_item_id: "item-001",
          state: "unmatched",
          extra: 1,
          looked_up_at: null,
          evidence: JSON.stringify({
            hints: { extra: true, strength: "weak" },
          }),
        },
      ],
    });
  });

  it("replaces an unmatched or failed decision with a newer lookup", async () => {
    const { db, writer } = await setup();
    await commit(writer, [
      lookedUp(itemFixture.path_key, {
        kind: "ambiguous",
        query: { title: "Alien" },
        candidates: [{ id: 1, title: "Alien" }],
      }),
    ]);
    await db
      .updateTable("metadata_matches")
      .set({ state: "unmatched" })
      .execute();

    await commit(writer, [lookedUp(itemFixture.path_key, ALIEN)]);

    const written = await metadata(db);
    expect(written.matches).toMatchObject([{ state: "matched" }]);
    expect(written.candidates).toEqual([]);
    expect(written.refs).toHaveLength(1);
  });

  it.each(["matched", "ambiguous", "rejected"] as const)(
    "never overwrites a %s decision made while the scan ran",
    async (state) => {
      const { db, writer } = await setup();
      await db
        .insertInto("metadata_matches")
        .values({
          media_item_id: itemFixture.id,
          state,
          extra: 0,
          lookup_error: null,
          looked_up_at: FIXTURE_TIME,
          evidence: "{}",
          matched_duration_ms: null,
        })
        .execute();
      const before = await metadata(db);

      await commit(writer, [lookedUp(itemFixture.path_key, ALIEN)]);

      await expect(metadata(db)).resolves.toEqual(before);
    },
  );

  it("clears a removed item's old decision when a scan rediscovers it", async () => {
    const { db, writer } = await setup();
    await commit(writer, [lookedUp(itemFixture.path_key, ALIEN)]);
    await db
      .updateTable("media_items")
      .set({ removed_at: SCANNED_AT })
      .execute();
    await db
      .updateTable("metadata_matches")
      .set({ state: "rejected" })
      .execute();

    await commit(writer, []);

    await expect(metadata(db)).resolves.toEqual({
      matches: [],
      facts: [],
      refs: [],
      candidates: [],
    });
  });

  it("writes a fresh lookup for a rediscovered removed item", async () => {
    const { db, writer } = await setup();
    await commit(writer, [lookedUp(itemFixture.path_key, ALIEN)]);
    await db
      .updateTable("media_items")
      .set({ removed_at: SCANNED_AT })
      .execute();

    await commit(writer, [
      lookedUp(itemFixture.path_key, {
        kind: "failed",
        query: { title: "Alien" },
        reason: "TMDB answered HTTP 503",
      }),
    ]);

    await expect(metadata(db)).resolves.toMatchObject({
      matches: [{ state: "unmatched", lookup_error: "TMDB answered HTTP 503" }],
      facts: [],
      refs: [],
    });
  });
});
