import { expect, it } from "vitest";
import type { CollectionStatus } from "../http/contracts/collections.js";
import { canAirWords } from "./collection-words.js";

const counts = (
  memberCount: number,
  schedulableCount: number,
  missingCount = 0,
  tooShortCount = 0,
  couldNotReadCount = 0,
): CollectionStatus => ({
  schedulable: schedulableCount > 0,
  memberCount,
  schedulableCount,
  missingCount,
  couldNotReadCount,
  tooShortCount,
});

it("tells an empty manual collection to add media and an empty automatic one only that nothing airs", () => {
  expect(canAirWords(counts(0, 0), "manual")).toBe(
    "Nothing to air yet, add media below.",
  );
  expect(canAirWords(counts(0, 0), "automatic")).toBe("Nothing to air yet.");
});

it("names only the causes present after the airable count", () => {
  expect(canAirWords(counts(2, 0, 1, 1), "manual")).toBe(
    "0 of 2 can air (1 missing, 1 too short)",
  );
  expect(canAirWords(counts(14, 12, 2), "automatic")).toBe(
    "12 of 14 can air (2 missing)",
  );
  expect(canAirWords(counts(3, 2, 0, 1), "manual")).toBe(
    "2 of 3 can air (1 too short)",
  );
  expect(canAirWords(counts(1, 0, 0, 0, 1), "manual")).toBe(
    "0 of 1 can air (1 could not be read)",
  );
  expect(canAirWords(counts(4, 1, 1, 1, 1), "automatic")).toBe(
    "1 of 4 can air (1 missing, 1 could not be read, 1 too short)",
  );
  expect(canAirWords(counts(1, 1), "manual")).toBe("1 of 1 can air");
  expect(canAirWords(counts(1200, 1200), "manual")).toBe(
    "1,200 of 1,200 can air",
  );
});
