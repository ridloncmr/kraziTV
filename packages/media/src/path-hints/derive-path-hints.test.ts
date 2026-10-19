import { describe, expect, it } from "vitest";

import { mediaPathSegments } from "../paths/media-path.js";
import { derivePathHints } from "./derive-path-hints.js";

// Paths in these tables are relative to the media root, as in the spec.
function hintsFor(relativePath: string) {
  return derivePathHints(relativePath.split("/"));
}

describe("derivePathHints", () => {
  // Spec 0001, Path Hints table, verbatim.
  it.each([
    [
      "Firefly/Season 1/s01e05.mp4",
      {
        series: "Firefly",
        seriesFolder: "Firefly",
        season: 1,
        episode: { first: 5, last: 5 },
        strength: "strong",
      },
    ],
    [
      "Firefly (2002)/s01e05.mp4",
      {
        series: "Firefly",
        seriesFolder: "Firefly (2002)",
        year: 2002,
        season: 1,
        episode: { first: 5, last: 5 },
        strength: "strong",
      },
    ],
    [
      "Show/s01e05-e06.mkv",
      {
        series: "Show",
        seriesFolder: "Show",
        season: 1,
        episode: { first: 5, last: 6 },
        strength: "strong",
      },
    ],
    [
      "Alien (1979)/movie.mkv",
      { title: "Alien", year: 1979, strength: "strong" },
    ],
    [
      "Some Show/t_01.mkv",
      {
        series: "Some Show",
        seriesFolder: "Some Show",
        track: 1,
        strength: "weak",
      },
    ],
    [
      "TV/Downloads/s01e05.mp4",
      { season: 1, episode: { first: 5, last: 5 }, strength: "weak" },
    ],
  ])("reads %s", (path, expected) => {
    expect(hintsFor(path)).toEqual({ extra: false, ...expected });
  });

  it("strips release tokens before extracting a title", () => {
    expect(
      hintsFor("Firefly (2002) [1080p BluRay x265]/Season 1/s01e05.mkv"),
    ).toMatchObject({ series: "Firefly", year: 2002, strength: "strong" });
    expect(
      hintsFor("Movies/Alien.1979.Remastered.2160p.UHD.HDR.x265.mkv"),
    ).toMatchObject({ title: "Alien", year: 1979 });
    expect(hintsFor("Movies/Heat (1995) WEB-DL HEVC DTS.mkv")).toEqual({
      title: "Heat",
      year: 1995,
      extra: false,
      strength: "strong",
    });
  });

  it("gives a Specials folder a season 0 hint", () => {
    expect(hintsFor("Firefly/Specials/s00e01.mkv")).toMatchObject({
      series: "Firefly",
      season: 0,
    });
    expect(hintsFor("Firefly/Specials/Serenity Gag Reel.mkv")).toMatchObject({
      series: "Firefly",
      season: 0,
      strength: "weak",
    });
  });

  it("skips a bare Series folder but reads Series 1 as a season", () => {
    expect(hintsFor("Series/Firefly/s01e05.mkv")).toMatchObject({
      series: "Firefly",
    });
    expect(hintsFor("Firefly/Series 2/e.mkv")).toMatchObject({
      series: "Firefly",
      season: 2,
    });
  });

  it.each([
    ["Staffel 3", 3],
    ["saison03", 3],
    ["Сезон 2", 2],
    ["シーズン1", 1],
    ["S04", 4],
  ])("reads the localized or short season folder %s", (folder, season) => {
    expect(hintsFor(`Show/${folder}/x.mkv`)).toMatchObject({
      series: "Show",
      season,
    });
  });

  it("never reads a bare number as a season", () => {
    expect(hintsFor("24/s01e01.mkv")).toMatchObject({
      series: "24",
      season: 1,
      strength: "strong",
    });
    expect(hintsFor("1923/Season 2/s02e03.mkv")).toMatchObject({
      series: "1923",
      season: 2,
    });
  });

  it("never treats a generic folder name as a series or title", () => {
    expect(hintsFor("TV Shows/Anime/s01e05.mkv")).not.toHaveProperty("series");
    expect(hintsFor("Movies/movie.mkv")).toEqual({
      extra: false,
      strength: "weak",
    });
    // The whole name must match, so My Movies is a title folder.
    expect(hintsFor("My Movies/movie.mkv")).toMatchObject({
      title: "My Movies",
    });
  });

  it("never treats the media root as a series", () => {
    const segments = mediaPathSegments(
      "/media/Firefly",
      "/media/Firefly/s01e05.mkv",
      "posix",
    );
    expect(derivePathHints(segments ?? [])).not.toHaveProperty("series");
  });

  // An extra is never matched, so it carries no name, season, or episode hints
  // that a lookup could mistake for its parent's.
  it.each([
    "Firefly/Featurettes/making-of.mkv",
    "Alien (1979)/Deleted Scenes/s01e05.mkv",
    "Firefly/Season 1/extras/t_01.mkv",
  ])("marks %s as a weak extra", (path) => {
    expect(hintsFor(path)).toEqual({ extra: true, strength: "weak" });
  });

  it("keeps disc and track numbers apart from season and episode", () => {
    expect(hintsFor("Some Show/Season 1/Disc 2/title_t03.mkv")).toEqual({
      series: "Some Show",
      seriesFolder: "Some Show",
      season: 1,
      disc: 2,
      track: 3,
      extra: false,
      strength: "weak",
    });
  });

  it("skips disc-structure and quality folders", () => {
    expect(hintsFor("Alien (1979)/1080p/VIDEO_TS/movie.mkv")).toMatchObject({
      title: "Alien",
      year: 1979,
    });
  });

  it.each([
    ["Firefly/Season 1/s01e05.mp4", "Firefly"],
    ["Firefly/Specials/s00e01.mp4", "Firefly"],
    [
      "Firefly (2002) [1080p BluRay x265]/Season 2/Disc 1/s02e01.mkv",
      "Firefly (2002) [1080p BluRay x265]",
    ],
    ["TV/Firefly/Season 1/Firefly - s01e05.mkv", "TV/Firefly"],
    ["TV/Random Stuff/Firefly.S01E05.mkv", "TV/Random Stuff"],
    // Scene names that differ from their series folder still share it.
    ["Grey's Anatomy/Season 2/Greys.Anatomy.S02E01.mkv", "Grey's Anatomy"],
    ["The Office (US)/Season 1/The.Office.US.S01E01.mkv", "The Office (US)"],
    [
      "Doctor Who (2005)/Season 1/Doctor.Who.2005.S01E01.mkv",
      "Doctor Who (2005)",
    ],
    ["Firefly.S01E05.mkv", ""],
  ])("names the folder %s's series came from as %j", (path, seriesFolder) => {
    expect(hintsFor(path)).toMatchObject({ seriesFolder });
  });

  it("names no series folder without a series", () => {
    expect(hintsFor("TV/Downloads/s01e05.mp4")).not.toHaveProperty(
      "seriesFolder",
    );
    expect(hintsFor("Alien (1979)/movie.mkv")).not.toHaveProperty(
      "seriesFolder",
    );
  });

  it("takes the series from the filename when it carries more than numbering", () => {
    expect(hintsFor("Random Stuff/Firefly.S01E05.720p.HDTV.mkv")).toEqual({
      series: "Firefly",
      seriesFolder: "Random Stuff",
      season: 1,
      episode: { first: 5, last: 5 },
      extra: false,
      strength: "strong",
    });
    expect(hintsFor("Firefly/Season 2/s02e01e02 - Pilot.mkv")).toMatchObject({
      series: "Firefly",
      season: 2,
      episode: { first: 1, last: 2 },
    });
  });

  it("prefers a movie filename's title, keeping the folder year when the names agree", () => {
    expect(hintsFor("Alien (1979)/Alien.mkv")).toMatchObject({
      title: "Alien",
      year: 1979,
    });
    // A scene-style name of the folder's title and year is the same thing.
    expect(hintsFor("Annabelle (2014)/Annabelle.2014.mp4")).toMatchObject({
      title: "Annabelle",
      year: 2014,
    });
    expect(hintsFor("Sci-Fi Night/Aliens (1986).mkv")).toMatchObject({
      title: "Aliens",
      year: 1986,
    });
    expect(hintsFor("Alien (1979)/Prometheus.mkv")).not.toHaveProperty("year");
  });

  it("uses a year-less movie folder as the title", () => {
    expect(hintsFor("The Thing/movie.mkv")).toEqual({
      title: "The Thing",
      extra: false,
      strength: "strong",
    });
  });

  it("lets the filename's season override its folder's", () => {
    expect(hintsFor("Show/Season 1/s02e03.mkv")).toMatchObject({ season: 2 });
  });

  it("drops a scene release group after a release token", () => {
    expect(hintsFor("Movies/Alien.1979.1080p.BluRay.x264-SPARKS.mkv")).toEqual({
      title: "Alien",
      year: 1979,
      extra: false,
      strength: "strong",
    });
    expect(
      hintsFor("Downloads/Firefly.S01.1080p.BluRay.x264-GROUP/s01e01.mkv"),
    ).toMatchObject({ series: "Firefly", season: 1, strength: "strong" });
  });

  it("removes parentheses left empty by release tokens", () => {
    expect(hintsFor("Movies/Heat (1995) (BluRay).mkv")).toMatchObject({
      title: "Heat",
      year: 1995,
    });
    expect(hintsFor("Firefly (2002) (1080p)/s01e01.mkv")).toMatchObject({
      series: "Firefly",
      year: 2002,
    });
  });

  it.each([
    ["Firefly/Season 1 (2002)/s01e01.mkv", "Firefly", 1],
    ["Firefly/Season 01 - 1080p/s01e01.mkv", "Firefly", 1],
    ["Firefly/Firefly Season 2/s02e01.mkv", "Firefly", 2],
    ["Doctor Who/Doctor Who S03/03 Smith and Jones.mkv", "Doctor Who", 3],
  ])(
    "never names a series after the season folder %s",
    (path, series, season) => {
      expect(hintsFor(path)).toMatchObject({ series, season });
    },
  );

  it("marks an extras folder as extra only when something named sits above it", () => {
    expect(
      hintsFor("Alien (1979)/Featurettes/The Beast Within/part1.mkv"),
    ).toEqual({ extra: true, strength: "weak" });
    // A top-level folder of that name organizes a library; it is not bonus material.
    expect(hintsFor("Other/Firefly/Season 1/s01e05.mkv")).toMatchObject({
      series: "Firefly",
      extra: false,
      strength: "strong",
    });
  });

  it("reads a scene-style year only right before a release token", () => {
    expect(hintsFor("Gladiator (2000)/Gladiator.2000.1080p.mkv")).toMatchObject(
      { title: "Gladiator", year: 2000 },
    );
    expect(hintsFor("Movies/1917.2019.2160p.mkv")).toMatchObject({
      title: "1917",
      year: 2019,
    });
    expect(hintsFor("Movies/Blade Runner 2049.mkv")).toEqual({
      title: "Blade Runner 2049",
      extra: false,
      strength: "strong",
    });
  });

  it("reads a track only in the rip forms t_NN and name_tNN", () => {
    expect(hintsFor("Terminator 2/T2.mkv")).toMatchObject({
      title: "T2",
      strength: "strong",
    });
    expect(hintsFor("Terminator 2/T2.mkv")).not.toHaveProperty("track");
  });

  it("never reads a resolution after an episode as a range", () => {
    expect(hintsFor("Show/s01e05-1080.mkv")).toMatchObject({
      episode: { first: 5, last: 5 },
    });
  });

  it("keeps the folder's casing when the folder and filename name the same thing", () => {
    expect(hintsFor("Alien (1979)/alien.mkv")).toMatchObject({
      title: "Alien",
      year: 1979,
    });
    expect(hintsFor("Firefly/firefly.s01e05.mkv")).toMatchObject({
      series: "Firefly",
    });
  });

  // The show's own folder holds its season folders, so it names the series
  // for every file beneath it, whatever the season folders are called.
  it.each([
    [
      "Survivor/Survivor - Season 44/Survivor - S44E10.mkv",
      { series: "Survivor", seriesFolder: "Survivor", season: 44 },
    ],
    [
      "Avatar - The Last Airbender (2005)/Book One - Water/Avatar - The Last Airbender - S01E07.mkv",
      {
        series: "Avatar - The Last Airbender",
        seriesFolder: "Avatar - The Last Airbender (2005)",
        year: 2005,
        season: 1,
      },
    ],
    [
      "Attack on Titan/Attack On Titan (Season 4 Part 2)/Attack on Titan - S04E17.mkv",
      { series: "Attack on Titan", seriesFolder: "Attack on Titan", season: 4 },
    ],
    ["Bleach/Season 04  The Bount/s04e65.mkv", { series: "Bleach", season: 4 }],
    [
      "Courage the Cowardly Dog (1999)/Season 1 (1999-2000)/s01e01.mkv",
      { series: "Courage the Cowardly Dog", year: 1999, season: 1 },
    ],
    [
      "Firefly (2002)/New Girl (2011) Season 05 S05 (1080p WEB-DL x265) [UTR]/s05e14.mkv",
      { series: "Firefly", year: 2002, season: 5 },
    ],
  ])("names the series from the outermost folder for %s", (path, expected) => {
    expect(hintsFor(path)).toMatchObject(expected);
  });

  it("lets the series folder's name and year win over a filename that agrees with it", () => {
    expect(
      hintsFor(
        "Mr Robot (2015)/Mr Robot (2015) Season 4/Mr Robot (2022) - S04E05.mkv",
      ),
    ).toMatchObject({ series: "Mr Robot", year: 2015, season: 4 });
    expect(
      hintsFor("Survivorman (2005)/Season 5/Survivorman and Son - S05E06.mkv"),
    ).toMatchObject({ series: "Survivorman", year: 2005 });
    expect(
      hintsFor(
        "Whose Line Is It Anyway (US) (1998)/Season 3/Whose Line Is It Anyway! (US) - S03E01.mkv",
      ),
    ).toMatchObject({
      series: "Whose Line Is It Anyway",
      country: "US",
      year: 1998,
    });
  });

  it("keeps a filename's own series when it names something else than its folder", () => {
    expect(
      hintsFor("The Brady Bunch (Complete TV series)/Brady Bunch S04E23.mp4"),
    ).toMatchObject({
      series: "Brady Bunch",
      seriesFolder: "The Brady Bunch (Complete TV series)",
    });
    expect(hintsFor("Random Stuff/Firefly (2002).S01E05.mkv")).toMatchObject({
      series: "Firefly",
      year: 2002,
    });
  });

  it("reads a country tag as a hint, never as part of the name", () => {
    expect(hintsFor("Shameless (US) (2011)/Season 9/s09e08.mkv")).toMatchObject(
      { series: "Shameless", country: "US", year: 2011 },
    );
    expect(hintsFor("The Office (UK)/s01e01.mkv")).toMatchObject({
      series: "The Office",
      country: "GB",
    });
  });

  it.each([
    [
      "Columbo/Columbo - (S07EP03) - (1978) Make Me a Perfect Murder.mp4",
      7,
      3,
      3,
    ],
    ["Show/Season 7/Show 7x03.mkv", 7, 3, 3],
    ["Regular Show/Season 3/Regular Show S03E04a In The House.mkv", 3, 4, 4],
    ["Rocket Power/Season 1/Rocket Power S01E01AB - New Squid.m4v", 1, 1, 1],
    ["Atlantis/Season 1/ATLANTIS - S01 E11 - Hunger Pangs.mp4", 1, 11, 11],
    ["Pokémon (1998)/s0/Pokemon - SS016 - Luvdisc.mkv", 0, 16, 16],
    ["Courage/Season 1/Courage - S01E11-E12 - Two Tales.mp4", 1, 11, 12],
  ])("reads the episode code in %s", (path, season, first, last) => {
    expect(hintsFor(path)).toMatchObject({
      season,
      episode: { first, last },
      strength: "strong",
    });
  });

  it("reads an episode numbered without a season, taking the folder's season when it has one", () => {
    expect(
      hintsFor("Anime/Wolverine/Wolverine - Episode 04 - Omega Red (720p).mp4"),
    ).toEqual({
      series: "Wolverine",
      seriesFolder: "Anime/Wolverine",
      episode: { first: 4, last: 4 },
      extra: false,
      strength: "strong",
    });
    expect(hintsFor("Wolverine/Season 1/Wolverine - Ep. 04.mp4")).toMatchObject(
      {
        series: "Wolverine",
        season: 1,
        episode: { first: 4, last: 4 },
      },
    );
  });

  it("reads a bare trailing number as the episode only under a season folder", () => {
    expect(hintsFor("Bleach/Season 04 The Bount/Bleach 64.mkv")).toMatchObject({
      series: "Bleach",
      season: 4,
      episode: { first: 64, last: 64 },
      strength: "strong",
    });
    expect(hintsFor("Movies/Apollo 13 (1995).mkv")).toMatchObject({
      title: "Apollo 13",
    });
    expect(hintsFor("Ocean's Eleven/Oceans 11.mkv")).not.toHaveProperty(
      "episode",
    );
  });

  it("drops edition labels and copy numbers from a movie title", () => {
    expect(
      hintsFor("Saw - Uncut Edition (2005)/Saw - Uncut Edition (2005).mkv"),
    ).toEqual({
      title: "Saw",
      year: 2005,
      extra: false,
      strength: "strong",
    });
    expect(
      hintsFor("Jumanji (1995)/Jumanji (1995)  Special Edition.mkv"),
    ).toMatchObject({ title: "Jumanji", year: 1995 });
    expect(
      hintsFor("College - Unrated (2008)/College - Unrated (2008).mkv"),
    ).toMatchObject({ title: "College", year: 2008 });
    expect(
      hintsFor(
        "Holiday in Handcuffs (2007)/Holiday in Handcuffs (2007)(1).mkv",
      ),
    ).toMatchObject({ title: "Holiday in Handcuffs", year: 2007 });
    expect(hintsFor("Movies/Uncut Gems (2019).mkv")).toMatchObject({
      title: "Uncut Gems",
    });
  });

  it("skips a Plex Versions folder and reads a Specials folder with a year range", () => {
    expect(
      hintsFor("College (2008)/Plex Versions/Optimized/College (2008).mp4"),
    ).toMatchObject({ title: "College", year: 2008 });
    expect(
      hintsFor("Courage (1999)/Specials (1995-2014)/Courage - S00E03.mp4"),
    ).toMatchObject({ series: "Courage", season: 0 });
  });
});
