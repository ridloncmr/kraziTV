import { describe, expect, it } from "vitest";

import { findCalendarProblem } from "./calendar-problems.js";
import type { CalendarConditions } from "./contracts.js";

const ANYTIME: CalendarConditions = {
  dates: { kind: "any" },
  weekdays: null,
  window: null,
};

describe("findCalendarProblem", () => {
  it.each<[string, Partial<CalendarConditions>]>([
    ["no conditions", {}],
    [
      "a one-off range of one day",
      {
        dates: {
          kind: "one_off",
          startDate: "2026-12-31",
          endDate: "2026-12-31",
        },
      },
    ],
    [
      "an annual range crossing the year end",
      {
        dates: { kind: "annual", startMonthDay: "11-15", endMonthDay: "01-15" },
      },
    ],
    [
      "an annual range ending February 29",
      {
        dates: { kind: "annual", startMonthDay: "02-01", endMonthDay: "02-29" },
      },
    ],
    ["Fridays and Saturdays", { weekdays: [5, 6] }],
    ["an overnight window", { window: { startMinute: 1320, endMinute: 120 } }],
    [
      "a window to the last minute",
      { window: { startMinute: 0, endMinute: 1439 } },
    ],
  ])("accepts %s", (_, partial) => {
    expect(findCalendarProblem({ ...ANYTIME, ...partial })).toBeNull();
  });

  it.each<[Partial<CalendarConditions>, string]>([
    [
      {
        dates: {
          kind: "one_off",
          startDate: "2026-12-32",
          endDate: "2027-01-01",
        },
      },
      "startDate must be a real YYYY-MM-DD date",
    ],
    [
      {
        dates: {
          kind: "one_off",
          startDate: "2027-01-02",
          endDate: "2027-01-01",
        },
      },
      "endDate must not be before startDate",
    ],
    [
      {
        dates: {
          kind: "one_off",
          startDate: "2027-02-29",
          endDate: "2027-03-01",
        },
      },
      "startDate must be a real YYYY-MM-DD date",
    ],
    [
      {
        dates: { kind: "annual", startMonthDay: "02-30", endMonthDay: "03-01" },
      },
      "startMonthDay must be a real MM-DD day of the year",
    ],
    [
      {
        dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "1-15" },
      },
      "endMonthDay must be a real MM-DD day of the year",
    ],
    [{ weekdays: [] }, "weekdays must name at least one day"],
    [{ weekdays: [5, 5] }, "weekdays must not repeat a day"],
    [{ weekdays: [7] }, "weekdays must be 0 (Sunday) through 6 (Saturday)"],
    [
      { window: { startMinute: 600, endMinute: 600 } },
      "a window must not start and end at the same minute",
    ],
    [
      { window: { startMinute: -1, endMinute: 600 } },
      "window minutes must be whole minutes from 0 through 1439",
    ],
    [
      { window: { startMinute: 0, endMinute: 1440 } },
      "window minutes must be whole minutes from 0 through 1439",
    ],
    [
      { window: { startMinute: 0.5, endMinute: 600 } },
      "window minutes must be whole minutes from 0 through 1439",
    ],
  ])("refuses %j", (partial, problem) => {
    expect(findCalendarProblem({ ...ANYTIME, ...partial })).toBe(problem);
  });
});
