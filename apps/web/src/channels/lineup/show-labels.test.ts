import { describe, expect, it } from "vitest";
import { joinShowNames } from "./show-labels.js";

describe("show labels", () => {
  it.each([
    [["Seinfeld"], "Seinfeld"],
    [["The Office", "Parks"], "The Office + Parks"],
    [["The Office", "Parks", "Cheers"], "The Office + Parks + 1 more"],
    [["A", "B", "C", "D"], "A + B + 2 more"],
  ])("joins member names %o as %s", (names, label) => {
    expect(joinShowNames(names)).toBe(label);
  });
});
