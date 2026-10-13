import { afterEach, expect, it } from "vitest";

import {
  FIXTURE_TIME,
  rootFixture,
  titledItemFixture,
} from "../../testing/catalog-fixtures.js";
import { episodeFacts } from "../../testing/collection-fixtures.js";
import { correctionRow } from "../../testing/metadata-match-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { readMatchableItems } from "./matchable-items.js";

afterEach(cleanUpTestEnvironment);

it("reads cataloged items' effective facts, skipping removed items and unmatching a corrected series", async () => {
  const { db } = await openTestDatabase();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db
    .insertInto("media_items")
    .values([
      titledItemFixture("pilot"),
      titledItemFixture("missing", { status: "missing" }),
      titledItemFixture("removed", { removed_at: FIXTURE_TIME }),
      titledItemFixture("corrected"),
    ])
    .execute();
  await db
    .insertInto("content_facts")
    .values([
      episodeFacts("pilot", 2316, 1, 1),
      episodeFacts("missing", 2316, 1, 2),
      episodeFacts("removed", 2316, 1, 3),
      episodeFacts("corrected", 2316, 1, 4),
    ])
    .execute();
  await db
    .insertInto("metadata_corrections")
    .values([
      correctionRow("pilot", { season_number: 3 }),
      correctionRow("corrected", { series_name: "Parks and Recreation" }),
    ])
    .execute();

  const items = await readMatchableItems(db);

  expect(
    items
      .map((item) => ({
        id: item.id,
        status: item.status,
        season: item.metadata.seasonNumber,
        series: item.identity.seriesTmdbId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  ).toEqual([
    { id: "corrected", status: "available", season: 1, series: null },
    { id: "missing", status: "missing", season: 1, series: 2316 },
    { id: "pilot", status: "available", season: 3, series: 2316 },
  ]);
});
