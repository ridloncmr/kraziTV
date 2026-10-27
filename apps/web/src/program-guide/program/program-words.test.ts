import { expect, it } from "vitest";
import type { GuideProgram } from "../../http/contracts/channels.js";
import { episodeCode, programDetail } from "./program-words.js";

const bare: GuideProgram = {
  title: "Item",
  subTitle: null,
  description: null,
  releaseDate: null,
  kind: null,
  genres: [],
  posterUrl: null,
  episode: null,
};

it("codes an episode as its season folder would, spanning a multi-episode file", () => {
  expect(episodeCode({ season: 1, episode: 5, lastEpisode: null })).toBe(
    "S01E05",
  );
  expect(episodeCode({ season: 1, episode: 5, lastEpisode: 5 })).toBe("S01E05");
  expect(episodeCode({ season: 0, episode: 12, lastEpisode: 13 })).toBe(
    "S00E12-E13",
  );
});

it("details an episode by its title, else its code, a movie by its year, and bare media by nothing", () => {
  expect(
    programDetail({
      ...bare,
      kind: "episode",
      subTitle: "The Train Job",
      episode: { season: 1, episode: 5, lastEpisode: null },
    }),
  ).toBe("The Train Job");
  expect(
    programDetail({
      ...bare,
      kind: "episode",
      episode: { season: 1, episode: 5, lastEpisode: null },
    }),
  ).toBe("S01E05");
  expect(
    programDetail({ ...bare, kind: "movie", releaseDate: "1979-05-25" }),
  ).toBe("1979");
  expect(programDetail(bare)).toBeNull();
});
