import { describe, expect, it } from "vitest";

import {
  assertNonNegativeSafeInteger,
  assertPositiveSafeInteger,
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

  it("accepts the smallest valid values", () => {
    expect(() => assertPositiveSafeInteger(1, "limitBytes")).not.toThrow();
    expect(() => assertNonNegativeSafeInteger(0, "graceMs")).not.toThrow();
  });
});
