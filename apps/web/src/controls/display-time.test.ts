import { expect, it } from "vitest";
import {
  displayClockTime,
  displayDay,
  displayListTime,
  displayTime,
  displayTimeRange,
  isSameDay,
} from "./display-time.js";

const instant = "2026-10-07T15:04:05.000Z";

it("shows the date and the time of day to the minute, with no seconds", () => {
  expect(displayTime(instant)).toBe(
    new Date(instant).toLocaleString(undefined, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  );
});

it("shows only the time of day, to the minute, for when something ends", () => {
  expect(displayClockTime(instant)).toBe(
    new Date(instant).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  );
});

it("names a range's date once when it ends the day it starts", () => {
  const later = "2026-10-07T16:30:00.000Z";
  expect(displayTimeRange(instant, later)).toBe(
    `${displayTime(instant)} – ${displayClockTime(later)}`,
  );
});

it("names both dates when a range crosses midnight", () => {
  const nextDay = "2026-10-09T01:00:00.000Z";
  expect(displayTimeRange(instant, nextDay)).toBe(
    `${displayTime(instant)} – ${displayTime(nextDay)}`,
  );
});

it("names a day for a heading and tells one day from the next", () => {
  expect(displayDay(instant)).toBe(
    new Date(instant).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
  );
  expect(isSameDay(instant, "2026-10-07T16:30:00.000Z")).toBe(true);
  expect(isSameDay(instant, "2026-10-09T01:00:00.000Z")).toBe(false);
});

it("gives a list's first item of each day its date and the rest only a time", () => {
  const later = "2026-10-07T16:30:00.000Z";
  expect(displayListTime(instant)).toBe(displayTime(instant));
  expect(displayListTime(later, instant)).toBe(displayClockTime(later));
  expect(displayListTime("2026-10-09T01:00:00.000Z", instant)).toBe(
    displayTime("2026-10-09T01:00:00.000Z"),
  );
});
