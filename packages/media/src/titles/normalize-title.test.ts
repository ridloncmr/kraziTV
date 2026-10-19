import { describe, expect, it } from "vitest";

import { normalizeTitle } from "./normalize-title.js";

describe("normalizeTitle", () => {
  it.each([
    ["Marvel's Agents of S.H.I.E.L.D.", "Marvels Agents of SHIELD"],
    ["The Thing", "thing"],
    ["Amélie", "Amelie"],
    ["Law & Order", "Law and Order"],
    ["  Star   Wars: A New Hope ", "star wars a new hope"],
  ])("treats %j and %j as the same title", (left, right) => {
    expect(normalizeTitle(left)).toBe(normalizeTitle(right));
  });

  it.each([
    ["Alien", "Aliens"],
    ["Theory", "Ory"],
    ["Them", "M"],
    ["Blade Runner", "Blade Runner 2049"],
  ])("keeps %j and %j apart", (left, right) => {
    expect(normalizeTitle(left)).not.toBe(normalizeTitle(right));
  });
});
