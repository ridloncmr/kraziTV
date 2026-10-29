import { expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./local-instant.js";

it("round-trips a local time through the instant it names", () => {
  const instant = new Date(2026, 9, 17, 20, 5).toISOString();

  expect(toLocalInput(instant)).toBe("2026-10-17T20:05");
  expect(fromLocalInput("2026-10-17T20:05")).toBe(instant);
});

it("reads an empty or malformed value as no instant", () => {
  expect(fromLocalInput("")).toBeUndefined();
  expect(fromLocalInput("not a time")).toBeUndefined();
});
