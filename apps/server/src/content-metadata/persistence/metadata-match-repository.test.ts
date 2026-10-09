import { afterEach, describe, expect, it } from "vitest";

import {
  FIXTURE_TIME,
  itemFixtureAt,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import { correctionRow } from "../../testing/metadata-match-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import type { Insertable } from "kysely";

import type { MetadataMatchTable } from "../../database/schema/metadata-match-table.js";
import { MetadataMatchRepository } from "./metadata-match-repository.js";

afterEach(cleanUpTestEnvironment);

const OTHER_ROOT = {
  ...rootFixture,
  id: "root-other",
  path: "/media/other",
  path_key: "/media/other",
};

// One item per decision kind under the fixture root, plus a matched item elsewhere.
const DECISIONS: [string, Partial<Insertable<MetadataMatchTable>>][] = [
  ["matched", { state: "matched" }],
  ["ambiguous", { state: "ambiguous" }],
  ["rejected", { state: "rejected" }],
  ["extra", { state: "unmatched", extra: 1, looked_up_at: null }],
  ["unmatched", { state: "unmatched" }],
  ["failed", { state: "unmatched", lookup_error: "TMDB answered HTTP 503" }],
];

describe("MetadataMatchRepository.findSettledPathKeys", () => {
  it("returns the root's items a scan must not look up again: matched, ambiguous, rejected, and extras", async () => {
    const { db } = await openTestDatabase();
    await db
      .insertInto("media_roots")
      .values([rootFixture, OTHER_ROOT])
      .execute();
    await db
      .insertInto("media_items")
      .values([
        ...DECISIONS.map(([name]) =>
          itemFixtureAt(`item-${name}`, `/media/movies/${name}.mkv`),
        ),
        itemFixtureAt("item-new", "/media/movies/new.mkv"),
        {
          ...itemFixtureAt("item-elsewhere", "/media/other/x.mkv"),
          media_root_id: OTHER_ROOT.id,
        },
      ])
      .execute();
    await db
      .insertInto("metadata_matches")
      .values(
        [...DECISIONS, ["elsewhere", { state: "matched" }] as const].map(
          ([name, decision]): Insertable<MetadataMatchTable> => ({
            media_item_id: `item-${name}`,
            state: "unmatched",
            extra: 0,
            lookup_error: null,
            looked_up_at: FIXTURE_TIME,
            evidence: "{}",
            matched_duration_ms: null,
            ...decision,
          }),
        ),
      )
      .execute();

    const settled = await new MetadataMatchRepository(db).findSettledPathKeys(
      rootFixture.id,
    );

    expect([...settled].sort()).toEqual([
      "/media/movies/ambiguous.mkv",
      "/media/movies/extra.mkv",
      "/media/movies/matched.mkv",
      "/media/movies/rejected.mkv",
    ]);
  });

  it("treats a removed item's decision as unsettled, since rediscovery starts it afresh", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("media_roots").values(rootFixture).execute();
    await db
      .insertInto("media_items")
      .values(
        itemFixtureAt("item-removed", "/media/movies/removed.mkv", {
          removed_at: FIXTURE_TIME,
        }),
      )
      .execute();
    await db
      .insertInto("metadata_matches")
      .values({
        media_item_id: "item-removed",
        state: "rejected",
        extra: 0,
        lookup_error: null,
        looked_up_at: FIXTURE_TIME,
        evidence: "{}",
        matched_duration_ms: null,
      })
      .execute();

    await expect(
      new MetadataMatchRepository(db).findSettledPathKeys(rootFixture.id),
    ).resolves.toEqual(new Set());
  });

  it("settles an item the owner corrected, even before any lookup, but not one only tagged", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("media_roots").values(rootFixture).execute();
    await db
      .insertInto("media_items")
      .values([
        itemFixtureAt("item-corrected", "/media/movies/corrected.mkv"),
        itemFixtureAt("item-tagged", "/media/movies/tagged.mkv"),
      ])
      .execute();
    await db
      .insertInto("metadata_corrections")
      .values([
        correctionRow("item-corrected", { episode_number: 3 }),
        correctionRow("item-tagged", { tags: '["space"]' }),
      ])
      .execute();

    await expect(
      new MetadataMatchRepository(db).findSettledPathKeys(rootFixture.id),
    ).resolves.toEqual(new Set(["/media/movies/corrected.mkv"]));
  });
});
