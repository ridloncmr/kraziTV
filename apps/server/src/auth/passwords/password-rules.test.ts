import { describe, expect, it } from "vitest";

import { newPasswordField, passwordField } from "./password-rules.js";

describe("password rules", () => {
  it.each([
    ["8 characters", "p".repeat(8)],
    ["256 characters", "p".repeat(256)],
    ["surrounding spaces, kept as typed", "  spaced  "],
  ])("accepts a new password of %s", (_, password) => {
    expect(newPasswordField.parse(password)).toBe(password);
  });

  it.each([
    ["7 characters", "p".repeat(7), "at least 8"],
    ["257 characters", "p".repeat(257), "at most 256"],
  ])("refuses a new password of %s", (_, password, message) => {
    const result = newPasswordField.safeParse(password);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(message);
  });

  it("checks any password up to 256 characters, however short", () => {
    expect(passwordField.safeParse("").success).toBe(true);
    expect(passwordField.safeParse("p".repeat(257)).success).toBe(false);
  });
});
