import { expect, it } from "vitest";
import { displayTime } from "./display-time.js";

it("shows the same fields as the locale default and names a missing instant", () => {
  const instant = "2026-10-07T15:04:05.000Z";
  expect(displayTime(instant)).toBe(new Date(instant).toLocaleString());
  expect(displayTime(null)).toBe("Not yet scanned");
});
