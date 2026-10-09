import { describe, expect, it } from "vitest";

import {
  THE_THING_1982,
  THE_THING_2011,
  THE_THING_1951,
  THING_1951,
} from "../testing/movie-summary-fixtures.js";
import { matchMovie } from "./match-movie.js";

describe("matchMovie", () => {
  it("matches the one result whose title and year agree with the hints", () => {
    const alien = { id: 348, title: "Alien", releaseDate: "1979-05-25" };

    expect(
      matchMovie({ title: "Alien", year: 1979, strength: "strong" }, [
        { id: 8077, title: "Alien³", releaseDate: "1992-05-22" },
        alien,
        { id: 9, title: "Alien", releaseDate: "2019-01-01" },
      ]),
    ).toEqual({ kind: "matched", movie: alien });
  });

  it("matches a lone same-titled result when there is no year hint", () => {
    expect(
      matchMovie({ title: "the thing", strength: "strong" }, [
        THE_THING_1982,
        THE_THING_1951,
      ]),
    ).toEqual({ kind: "matched", movie: THE_THING_1982 });
  });

  it("leaves several same-titled results ambiguous, never choosing by TMDB's order", () => {
    expect(
      matchMovie({ title: "The Thing", strength: "strong" }, [
        THE_THING_2011,
        THE_THING_1982,
        THING_1951,
      ]),
    ).toEqual({
      kind: "ambiguous",
      candidates: [THE_THING_2011, THE_THING_1982, THING_1951],
    });
  });

  it("offers every result when none has the hinted title and year", () => {
    expect(
      matchMovie({ title: "The Thing", year: 1999, strength: "strong" }, [
        THE_THING_1982,
        THE_THING_2011,
      ]),
    ).toEqual({
      kind: "ambiguous",
      candidates: [THE_THING_1982, THE_THING_2011],
    });
  });

  it("never matches from weak hints, even with one result", () => {
    expect(
      matchMovie({ title: "The Thing", year: 1982, strength: "weak" }, [
        THE_THING_1982,
      ]),
    ).toEqual({ kind: "ambiguous", candidates: [THE_THING_1982] });
  });

  it("reports no results as unmatched", () => {
    expect(
      matchMovie({ title: "Nothing Like It", strength: "strong" }, []),
    ).toEqual({ kind: "unmatched" });
  });

  it("does not match a result with no release date to a year hint", () => {
    const undated = { id: 5, title: "Alien" };

    expect(
      matchMovie({ title: "Alien", year: 1979, strength: "strong" }, [undated]),
    ).toEqual({ kind: "ambiguous", candidates: [undated] });
  });
});
