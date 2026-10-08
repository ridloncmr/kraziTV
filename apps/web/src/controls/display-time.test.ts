import { expect, it } from "vitest";
import { displayClockTime, displayTime } from "./display-time.js";

it("shows the same fields as the locale default and names a missing instant", () => {
  const instant = "2026-10-07T15:04:05.000Z";
  expect(displayTime(instant)).toBe(new Date(instant).toLocaleString());
  expect(displayTime(null)).toBe("Not yet scanned");
});

it("shows only the time of day, to the minute, for when something ends", () => {
  const instant = "2026-10-07T15:04:05.000Z";
  expect(displayClockTime(instant)).toBe(
    new Date(instant).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  );
});
