import { waiting } from "../../testing/metadata-match-fixtures.js";
import { describe, expect, it } from "vitest";

import { groupReviewSteps } from "./review-steps.js";

describe("groupReviewSteps", () => {
  it("makes forty episodes under one series folder one step, across season folders", () => {
    const episodes = Array.from({ length: 40 }, (_, index) =>
      waiting(
        `Doctor Who/Season ${1 + (index % 2)}/s0${1 + (index % 2)}e${index + 1}.mkv`,
      ),
    );

    expect(groupReviewSteps(episodes)).toEqual([
      { mediaItemId: episodes[0]?.id, title: "Doctor Who", itemCount: 40 },
    ]);
  });

  it("makes each movie file its own step, named by its title hint", () => {
    expect(
      groupReviewSteps([
        waiting("The Thing/movie.mkv"),
        waiting("Solaris/movie.mkv"),
      ]),
    ).toEqual([
      {
        mediaItemId: "root-a:The Thing/movie.mkv",
        title: "The Thing",
        itemCount: 1,
      },
      {
        mediaItemId: "root-a:Solaris/movie.mkv",
        title: "Solaris",
        itemCount: 1,
      },
    ]);
  });

  it("leaves out disc tracks", () => {
    expect(
      groupReviewSteps([
        waiting("Some Show/Disc 1/t_00.mkv"),
        waiting("Some Show/Disc 1/t_01.mkv"),
      ]),
    ).toEqual([]);
  });

  it("keeps the same series folder under two roots apart, in the items' order", () => {
    expect(
      groupReviewSteps([
        waiting("Doctor Who/s01e01.mkv", "root-a"),
        waiting("The Thing/movie.mkv", "root-a"),
        waiting("Doctor Who/s01e01.mkv", "root-b"),
        waiting("Doctor Who/s01e02.mkv", "root-a"),
      ]).map((step) => [step.mediaItemId, step.itemCount]),
    ).toEqual([
      ["root-a:Doctor Who/s01e01.mkv", 2],
      ["root-a:The Thing/movie.mkv", 1],
      ["root-b:Doctor Who/s01e01.mkv", 1],
    ]);
  });
});
