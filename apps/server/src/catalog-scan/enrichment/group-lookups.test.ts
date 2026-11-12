import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { HintedCandidate } from "../contracts.js";
import { ROOT } from "../../testing/enrichment-scan.js";
import { hinted } from "../../testing/metadata-match-fixtures.js";
import { groupLookups, wouldSearch } from "./group-lookups.js";

// Each group's search hints and the path keys it decides for.
function summarize(items: readonly HintedCandidate[], settled: string[] = []) {
  const { extras, groups } = groupLookups(items, new Set(settled), true);
  return {
    extras: extras.map((extra) => extra.pathKey),
    groups: groups.map((group) => ({
      kind: group.kind,
      hints: group.hints,
      files: group.files.map((file) => file.pathKey),
    })),
  };
}

describe("groupLookups", () => {
  it("shares one series search across every season folder under a series folder", () => {
    const { groups } = summarize([
      hinted("Firefly/Season 1/s01e01.mkv"),
      hinted("Firefly/Season 2/s02e01.mkv"),
      hinted("Firefly/Specials/s00e01.mkv"),
    ]);

    expect(groups).toEqual([
      {
        kind: "series",
        hints: { title: "Firefly", strength: "strong" },
        files: [
          "Firefly/Season 1/s01e01.mkv",
          "Firefly/Season 2/s02e01.mkv",
          "Firefly/Specials/s00e01.mkv",
        ],
      },
    ]);
  });

  it("carries each episode file's season and episode range", () => {
    const { groups } = groupLookups(
      [hinted("Show/s01e05-e06.mkv")],
      new Set(),
      true,
    );

    expect(groups[0]).toMatchObject({
      kind: "series",
      files: [{ episode: { season: 1, episode: { first: 5, last: 6 } } }],
    });
  });

  it("carries an episode numbered without a season as such", () => {
    const { groups } = groupLookups(
      [hinted("Anime/Wolverine/Wolverine - Episode 04.mp4")],
      new Set(),
      true,
    );

    expect(groups[0]).toMatchObject({
      kind: "series",
      hints: { title: "Wolverine" },
      files: [{ episode: { episode: { first: 4, last: 4 } } }],
    });
    expect(
      groups[0]?.kind === "series" && groups[0].files[0]?.episode,
    ).not.toHaveProperty("season");
  });

  it("searches separately for same-named series in different series folders or years", () => {
    const { groups } = summarize([
      hinted("Classic/Doctor Who/s01e01.mkv"),
      hinted("Modern/Doctor Who/s01e01.mkv"),
      hinted("Doctor Who (2005)/s01e01.mkv"),
      hinted("Doctor Who (2005)/s01e02.mkv"),
    ]);

    expect(groups.map((group) => group.files)).toEqual([
      ["Classic/Doctor Who/s01e01.mkv"],
      ["Modern/Doctor Who/s01e01.mkv"],
      ["Doctor Who (2005)/s01e01.mkv", "Doctor Who (2005)/s01e02.mkv"],
    ]);
    expect(groups[2]?.hints).toEqual({
      title: "Doctor Who",
      year: 2005,
      strength: "strong",
    });
  });

  it("searches separately for series that only filenames name in one folder", () => {
    const { groups } = summarize([
      hinted("Downloads/Firefly.S01E01.mkv"),
      hinted("Downloads/Farscape.S01E01.mkv"),
      hinted("Downloads/firefly.S01E02.mkv"),
    ]);

    expect(groups.map((group) => group.files)).toEqual([
      ["Downloads/Firefly.S01E01.mkv", "Downloads/firefly.S01E02.mkv"],
      ["Downloads/Farscape.S01E01.mkv"],
    ]);
  });

  it("keeps grouping movies by title and year beside series", () => {
    const { groups } = summarize([
      hinted("Alien (1979)/movie.mkv"),
      hinted("Firefly/Season 1/s01e01.mkv"),
      hinted("Movies/Alien (1979).mkv"),
    ]);

    expect(groups).toEqual([
      {
        kind: "movie",
        hints: { title: "Alien", year: 1979, strength: "strong" },
        files: ["Alien (1979)/movie.mkv", "Movies/Alien (1979).mkv"],
      },
      {
        kind: "series",
        hints: { title: "Firefly", strength: "strong" },
        files: ["Firefly/Season 1/s01e01.mkv"],
      },
    ]);
  });

  it("records extras without a lookup and never looks up weak episode hints", () => {
    expect(
      summarize([
        hinted("Firefly/Featurettes/s01e01.mkv"),
        hinted("Some Show/t_01.mkv"),
        hinted("TV/Downloads/s01e05.mp4"),
        hinted("Firefly/Season 1/extras.mkv"),
      ]),
    ).toEqual({ extras: ["Firefly/Featurettes/s01e01.mkv"], groups: [] });
  });

  it("skips settled and unprobed files", () => {
    const { groups } = summarize(
      [
        hinted("Firefly/Season 1/s01e01.mkv"),
        hinted("Firefly/Season 1/s01e02.mkv", {
          status: "probe_failed",
          probeError: "invalid_metadata: not media",
        }),
        hinted("Firefly/Season 1/s01e03.mkv"),
      ],
      ["Firefly/Season 1/s01e01.mkv"],
    );

    expect(groups.map((group) => group.files)).toEqual([
      ["Firefly/Season 1/s01e03.mkv"],
    ]);
  });

  it("records only extras when there is nothing to look up with", () => {
    const { extras, groups } = groupLookups(
      [
        hinted("Firefly/Featurettes/making-of.mkv"),
        hinted("Firefly/Season 1/s01e01.mkv"),
      ],
      new Set(),
      false,
    );

    expect(extras.map((extra) => extra.pathKey)).toEqual([
      "Firefly/Featurettes/making-of.mkv",
    ]);
    expect(groups).toEqual([]);
  });
});

describe("wouldSearch", () => {
  it("accepts exactly the files a lookup puts in a search", () => {
    const files = [
      "Alien (1979)/movie.mkv",
      "Alien (1979)/Featurettes/making-of.mkv",
      "Firefly/Season 1/b.mkv",
      "Firefly/Season 1/s01e01.mkv",
      "Show/Disc 1/title_t00.mkv",
    ];
    const searched = summarize(files.map((file) => hinted(file))).groups;

    const accepted = files.filter((file) =>
      wouldSearch(ROOT, join(ROOT, file)),
    );

    expect(accepted).toEqual([
      "Alien (1979)/movie.mkv",
      "Firefly/Season 1/s01e01.mkv",
    ]);
    expect(searched.flatMap((group) => group.files).sort()).toEqual(accepted);
  });

  it("answers each file by its root as well as its path when asked again", () => {
    // A movie's folder names its title, so under the movie's own folder as a
    // root the same file names nothing, and outside it hints nothing at all.
    const path = join(ROOT, "Alien (1979)/movie.mkv");
    const roots = [ROOT, join(ROOT, "Alien (1979)"), join(ROOT, "Elsewhere")];

    const first = roots.map((root) => wouldSearch(root, path));
    const again = roots.map((root) => wouldSearch(root, path));

    expect(first).toEqual([true, false, false]);
    expect(again).toEqual(first);
  });
});
