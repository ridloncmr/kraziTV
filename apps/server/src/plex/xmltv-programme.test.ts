import { expect, it } from "vitest";

import { offAirProgramme, xmltvProgramme } from "./xmltv-programme.js";

const entry = { startsAt: 1_000, endsAt: 2_000 };
const bare = {
  title: "Item 1",
  subTitle: null,
  description: null,
  releaseDate: null,
  kind: null,
  genres: [],
  posterUrl: null,
  episode: null,
};

it("compacts the release date and leads the genres with the program's kind", () => {
  expect(
    xmltvProgramme(entry, {
      ...bare,
      title: "Firefly",
      subTitle: "The Train Job",
      releaseDate: "2002-09-20",
      kind: "episode",
      genres: ["Drama"],
      posterUrl: "https://image.tmdb.org/t/p/w500/firefly.jpg",
      episode: { season: 1, episode: 5, lastEpisode: 6 },
    }),
  ).toEqual({
    startsAt: 1_000,
    endsAt: 2_000,
    title: "Firefly",
    subTitle: "The Train Job",
    description: null,
    date: "20020920",
    categories: ["Series", "Drama"],
    iconUrl: "https://image.tmdb.org/t/p/w500/firefly.jpg",
    episode: { season: 1, episode: 5, lastEpisode: 6 },
  });
  expect(
    xmltvProgramme(entry, { ...bare, kind: "movie", releaseDate: "1979" })
      .categories,
  ).toEqual(["Movie"]);
});

it("passes a bare program through with no categories or date", () => {
  expect(xmltvProgramme(entry, bare)).toEqual({
    startsAt: 1_000,
    endsAt: 2_000,
    title: "Item 1",
    subTitle: null,
    description: null,
    date: null,
    categories: [],
    iconUrl: null,
    episode: null,
  });
});

it("lists planned filler as Off air with when programming resumes, in the programming timezone", () => {
  const startsAt = Date.parse("2026-10-05T00:45:00.000Z");
  const endsAt = Date.parse("2026-10-05T01:00:00.000Z");

  expect(offAirProgramme({ startsAt, endsAt }, "America/Chicago")).toEqual({
    startsAt,
    endsAt,
    title: "Off air",
    description: "Programming resumes at 8:00 PM.",
  });
});
