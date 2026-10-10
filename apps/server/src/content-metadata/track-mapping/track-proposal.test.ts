import { describe, expect, it } from "vitest";

import type { FolderTrack } from "../contracts.js";
import { compareTracks, proposeTrackMapping } from "./track-proposal.js";

import { track } from "../../testing/track-proposal-fixtures.js";

// Each row as `id: episode`, with `-` for a skipped track.
function proposal(tracks: FolderTrack[], episodes = [1, 2, 3, 4, 5, 6, 7, 8]) {
  return proposeTrackMapping(tracks, episodes).map(
    (row) => `${row.mediaItemId}: ${row.episodeNumber ?? "-"}`,
  );
}

describe("proposeTrackMapping", () => {
  it("continues episode numbers from one disc into the next", () => {
    expect(
      proposal([
        track(1, 0, 44),
        track(1, 1, 45),
        track(2, 0, 43),
        track(2, 1, 44),
      ]),
    ).toEqual(["d1t0: 1", "d1t1: 2", "d2t0: 3", "d2t1: 4"]);
  });

  it("starts a play-all track and a short track skipped, numbering the rest", () => {
    expect(
      proposal([
        track(1, 0, 132),
        track(1, 1, 44),
        track(1, 2, 45),
        track(1, 3, 43),
        track(1, 4, 3),
      ]),
    ).toEqual(["d1t0: -", "d1t1: 1", "d1t2: 2", "d1t3: 3", "d1t4: -"]);
  });

  it("finds a play-all track against its own disc, not the whole folder", () => {
    expect(
      proposal([
        track(1, 0, 44),
        track(1, 1, 45),
        track(2, 0, 87),
        track(2, 1, 43),
        track(2, 2, 44),
      ]),
    ).toEqual(["d1t0: 1", "d1t1: 2", "d2t0: -", "d2t1: 3", "d2t2: 4"]);
  });

  it("skips tracks left after the season's last episode", () => {
    expect(
      proposal([track(1, 0, 44), track(1, 1, 45), track(1, 2, 44)], [7, 8]),
    ).toEqual(["d1t0: 7", "d1t1: 8", "d1t2: -"]);
  });

  it("numbers a track without a probed duration and never skips it", () => {
    expect(
      proposal([track(1, 0, 44), track(1, 1, null), track(1, 2, 45)]),
    ).toEqual(["d1t0: 1", "d1t1: 2", "d1t2: 3"]);
  });
});

describe("compareTracks", () => {
  it("orders disc by disc, then by track", () => {
    const tracks = [track(2, 0, 1), track(1, 1, 1), track(1, 0, 1)];
    expect(tracks.sort(compareTracks).map((t) => t.mediaItemId)).toEqual([
      "d1t0",
      "d1t1",
      "d2t0",
    ]);
  });

  it("orders tracks without disc folders by track, then file name", () => {
    const tracks = [
      track(null, 1, 1, "Show/b_t01.mkv"),
      track(null, 1, 1, "Show/a_t01.mkv"),
      track(null, 0, 1, "Show/t_00.mkv"),
    ];
    expect(tracks.sort(compareTracks).map((t) => t.path)).toEqual([
      "Show/t_00.mkv",
      "Show/a_t01.mkv",
      "Show/b_t01.mkv",
    ]);
  });
});
