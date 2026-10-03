import { describe, expect, it } from "vitest";

import {
  assertNonNegativeSafeInteger,
  assertPositiveSafeInteger,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "./safe-integer-option.js";

describe("safe integer options", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects %s as a positive limit",
    (value) => {
      expect(() => assertPositiveSafeInteger(value, "limitBytes")).toThrow(
        new RangeError("limitBytes must be a positive safe integer"),
      );
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects %s as a non-negative delay",
    (value) => {
      expect(() => assertNonNegativeSafeInteger(value, "graceMs")).toThrow(
        new RangeError("graceMs must be a non-negative safe integer"),
      );
    },
  );

  it("classifies values without throwing for callers with their own errors", () => {
    expect(isPositiveSafeInteger(1)).toBe(true);
    expect(isPositiveSafeInteger(0)).toBe(false);
    expect(isNonNegativeSafeInteger(0)).toBe(true);
    expect(isNonNegativeSafeInteger(-1)).toBe(false);
    expect(isNonNegativeSafeInteger(1.5)).toBe(false);
  });

  it("accepts the smallest valid values", () => {
    expect(() => assertPositiveSafeInteger(1, "limitBytes")).not.toThrow();
    expect(() => assertNonNegativeSafeInteger(0, "graceMs")).not.toThrow();
  });
});
