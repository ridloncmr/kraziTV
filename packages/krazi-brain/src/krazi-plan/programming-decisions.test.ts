import { describe, expect, it } from "vitest";

import { roundKey, shuffleRound } from "./programming-decisions.js";

const SEED = { programmingSeed: 0x1234abcd, rebuildCount: 0 };
const IDS = ["a", "b", "c", "d", "e", "f"];

describe("roundKey", () => {
  it("keeps the default context's bare round number, so channels without features draw as before", () => {
    expect(roundKey("default", 3)).toBe(3);
  });

  it("draws a feature context's rounds apart from the default context's", () => {
    const orders = (context: string) =>
      [1, 2, 3, 4, 5, 6].map((round) =>
        shuffleRound(IDS, SEED, roundKey(context, round)).join(),
      );

    expect(orders("rule:fridays")).not.toEqual(orders("default"));
    expect(orders("rule:fridays")).not.toEqual(orders("rule:mondays"));
  });
});
