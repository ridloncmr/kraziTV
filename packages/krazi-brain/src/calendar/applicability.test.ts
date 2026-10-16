import { describe, expect, it } from "vitest";

import { appliesAt, nextApplicabilityChange } from "./applicability.js";
import type { CalendarConditions } from "./contracts.js";

const NEW_YORK = "America/New_York";
const FRIDAY = 5;
const SATURDAY = 6;

/** Builds conditions from the parts a test cares about; the rest are unrestricted. */
function conditions(
  partial: Partial<CalendarConditions> = {},
): CalendarConditions {
  return { dates: { kind: "any" }, weekdays: null, window: null, ...partial };
}

/** Local minutes from `HH:MM`. */
function at(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

const utc = (iso: string) => Date.parse(iso);

describe("appliesAt", () => {
  const fridayEvening = conditions({
    weekdays: [FRIDAY],
    window: { startMinute: at("18:00"), endMinute: at("23:00") },
  });

  it("evaluates a Friday evening window in local time on both sides of a DST change", () => {
    // 2026-10-30 is a Friday in EDT (UTC-4); 2026-11-06 is a Friday in EST (UTC-5).
    expect(
      appliesAt(fridayEvening, utc("2026-10-30T22:00:00Z"), NEW_YORK),
    ).toBe(true);
    expect(
      appliesAt(fridayEvening, utc("2026-10-30T21:59:00Z"), NEW_YORK),
    ).toBe(false);
    expect(
      appliesAt(fridayEvening, utc("2026-11-06T23:00:00Z"), NEW_YORK),
    ).toBe(true);
    // 17:30 EST, although 22:30 UTC would be inside the window in EDT.
    expect(
      appliesAt(fridayEvening, utc("2026-11-06T22:30:00Z"), NEW_YORK),
    ).toBe(false);
  });

  it("treats a window as half-open", () => {
    const inUtc = conditions({
      window: { startMinute: at("18:00"), endMinute: at("23:00") },
    });
    expect(appliesAt(inUtc, utc("2026-01-02T18:00:00Z"), "UTC")).toBe(true);
    expect(appliesAt(inUtc, utc("2026-01-02T22:59:59Z"), "UTC")).toBe(true);
    expect(appliesAt(inUtc, utc("2026-01-02T23:00:00Z"), "UTC")).toBe(false);
  });

  it("counts an overnight window's hours after midnight as the day it started", () => {
    const fridayNight = conditions({
      weekdays: [FRIDAY],
      window: { startMinute: at("22:00"), endMinute: at("02:00") },
    });
    // 2026-01-02 is a Friday.
    expect(appliesAt(fridayNight, utc("2026-01-02T22:00:00Z"), "UTC")).toBe(
      true,
    );
    expect(appliesAt(fridayNight, utc("2026-01-03T01:30:00Z"), "UTC")).toBe(
      true,
    );
    expect(appliesAt(fridayNight, utc("2026-01-03T02:00:00Z"), "UTC")).toBe(
      false,
    );
    // Friday's early hours belong to Thursday's window.
    expect(appliesAt(fridayNight, utc("2026-01-02T01:00:00Z"), "UTC")).toBe(
      false,
    );
    expect(appliesAt(fridayNight, utc("2026-01-03T22:30:00Z"), "UTC")).toBe(
      false,
    );
  });

  it("dates an overnight window by the day it started, so a range's last night runs past it", () => {
    const newYearsEve = conditions({
      dates: {
        kind: "one_off",
        startDate: "2026-12-31",
        endDate: "2026-12-31",
      },
      window: { startMinute: at("20:00"), endMinute: at("03:00") },
    });
    expect(appliesAt(newYearsEve, utc("2027-01-01T02:00:00Z"), "UTC")).toBe(
      true,
    );
    expect(appliesAt(newYearsEve, utc("2027-01-01T20:00:00Z"), "UTC")).toBe(
      false,
    );
  });

  it("recurs an annual December range every year and nowhere else", () => {
    const december = conditions({
      dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "12-31" },
    });
    for (const iso of [
      "2026-12-01T00:00:00Z",
      "2026-12-31T23:59:00Z",
      "2027-12-15T12:00:00Z",
      "2031-12-25T08:00:00Z",
    ]) {
      expect(appliesAt(december, utc(iso), "UTC")).toBe(true);
    }
    for (const iso of ["2026-11-30T23:59:00Z", "2027-01-01T00:00:00Z"]) {
      expect(appliesAt(december, utc(iso), "UTC")).toBe(false);
    }
  });

  it("evaluates annual dates on the local calendar, not the UTC one", () => {
    const december = conditions({
      dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "12-31" },
    });
    // 2026-12-01T03:00Z is still November 30 in New York.
    expect(appliesAt(december, utc("2026-12-01T03:00:00Z"), NEW_YORK)).toBe(
      false,
    );
    expect(appliesAt(december, utc("2027-01-01T03:00:00Z"), NEW_YORK)).toBe(
      true,
    );
  });

  it("crosses the year end for an annual range from November 15 to January 15", () => {
    const winter = conditions({
      dates: { kind: "annual", startMonthDay: "11-15", endMonthDay: "01-15" },
    });
    for (const iso of [
      "2026-11-15T00:00:00Z",
      "2026-12-31T12:00:00Z",
      "2027-01-01T00:00:00Z",
      "2027-01-15T23:59:00Z",
    ]) {
      expect(appliesAt(winter, utc(iso), "UTC")).toBe(true);
    }
    for (const iso of [
      "2026-11-14T23:59:00Z",
      "2027-01-16T00:00:00Z",
      "2027-07-01T00:00:00Z",
    ]) {
      expect(appliesAt(winter, utc(iso), "UTC")).toBe(false);
    }
  });

  it("ends an annual range at February 28 in a non-leap year when it names February 29", () => {
    const lateWinter = conditions({
      dates: { kind: "annual", startMonthDay: "02-01", endMonthDay: "02-29" },
    });
    expect(appliesAt(lateWinter, utc("2027-02-28T12:00:00Z"), "UTC")).toBe(
      true,
    );
    expect(appliesAt(lateWinter, utc("2027-03-01T00:00:00Z"), "UTC")).toBe(
      false,
    );
    expect(appliesAt(lateWinter, utc("2028-02-29T12:00:00Z"), "UTC")).toBe(
      true,
    );
    expect(appliesAt(lateWinter, utc("2028-03-01T00:00:00Z"), "UTC")).toBe(
      false,
    );
    expect(appliesAt(lateWinter, utc("2029-02-28T12:00:00Z"), "UTC")).toBe(
      true,
    );
    expect(appliesAt(lateWinter, utc("2029-03-01T00:00:00Z"), "UTC")).toBe(
      false,
    );
  });

  it("starts an annual range at February 28 in a non-leap year when it names February 29", () => {
    const leapDay = conditions({
      dates: { kind: "annual", startMonthDay: "02-29", endMonthDay: "03-01" },
    });
    expect(appliesAt(leapDay, utc("2027-02-28T12:00:00Z"), "UTC")).toBe(true);
    expect(appliesAt(leapDay, utc("2028-02-28T12:00:00Z"), "UTC")).toBe(false);
    expect(appliesAt(leapDay, utc("2028-02-29T12:00:00Z"), "UTC")).toBe(true);
  });

  it("includes both endpoints of a one-off date range", () => {
    const weekend = conditions({
      dates: {
        kind: "one_off",
        startDate: "2026-07-03",
        endDate: "2026-07-05",
      },
    });
    expect(appliesAt(weekend, utc("2026-07-02T23:59:00Z"), "UTC")).toBe(false);
    expect(appliesAt(weekend, utc("2026-07-03T00:00:00Z"), "UTC")).toBe(true);
    expect(appliesAt(weekend, utc("2026-07-05T23:59:00Z"), "UTC")).toBe(true);
    expect(appliesAt(weekend, utc("2026-07-06T00:00:00Z"), "UTC")).toBe(false);
    // A one-off range never recurs.
    expect(appliesAt(weekend, utc("2027-07-04T00:00:00Z"), "UTC")).toBe(false);
  });

  it("applies both occurrences of a repeated local time during fall-back", () => {
    // New York repeats 01:00-02:00 on 2026-11-01.
    const lateNight = conditions({
      window: { startMinute: at("01:00"), endMinute: at("02:00") },
    });
    expect(appliesAt(lateNight, utc("2026-11-01T05:30:00Z"), NEW_YORK)).toBe(
      true,
    );
    expect(appliesAt(lateNight, utc("2026-11-01T06:30:00Z"), NEW_YORK)).toBe(
      true,
    );
    expect(appliesAt(lateNight, utc("2026-11-01T07:00:00Z"), NEW_YORK)).toBe(
      false,
    );
  });

  it("gives a local time skipped by spring-forward no instant", () => {
    // New York skips 02:00-03:00 on 2026-03-08.
    const skipped = conditions({
      window: { startMinute: at("02:00"), endMinute: at("03:00") },
    });
    for (let minute = 0; minute < 180; minute += 1) {
      const instant = utc("2026-03-08T06:00:00Z") + minute * 60_000;
      expect(appliesAt(skipped, instant, NEW_YORK)).toBe(false);
    }
  });

  it("combines every condition with AND", () => {
    const decemberFridayEvening = conditions({
      dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "12-31" },
      weekdays: [FRIDAY],
      window: { startMinute: at("18:00"), endMinute: at("23:00") },
    });
    // 2026-12-04 is a Friday; 2026-12-05 a Saturday; 2026-11-27 a Friday.
    expect(
      appliesAt(decemberFridayEvening, utc("2026-12-04T19:00:00Z"), "UTC"),
    ).toBe(true);
    expect(
      appliesAt(decemberFridayEvening, utc("2026-12-05T19:00:00Z"), "UTC"),
    ).toBe(false);
    expect(
      appliesAt(decemberFridayEvening, utc("2026-11-27T19:00:00Z"), "UTC"),
    ).toBe(false);
    expect(
      appliesAt(decemberFridayEvening, utc("2026-12-04T17:00:00Z"), "UTC"),
    ).toBe(false);
  });

  it("applies everywhere when no condition is set", () => {
    expect(appliesAt(conditions(), utc("2026-06-15T12:34:00Z"), NEW_YORK)).toBe(
      true,
    );
  });
});

describe("nextApplicabilityChange", () => {
  it("steps to a window's start and end in local time", () => {
    const evening = conditions({
      weekdays: [FRIDAY],
      window: { startMinute: at("18:00"), endMinute: at("23:00") },
    });
    // Friday 2026-10-30 12:00 EDT.
    const noon = utc("2026-10-30T16:00:00Z");
    const start = nextApplicabilityChange(evening, noon, NEW_YORK);
    expect(start).toBe(utc("2026-10-30T22:00:00Z"));
    expect(nextApplicabilityChange(evening, start, NEW_YORK)).toBe(
      utc("2026-10-31T03:00:00Z"),
    );
  });

  it("steps to local midnight, where date and weekday conditions change", () => {
    const saturdays = conditions({ weekdays: [SATURDAY] });
    expect(
      nextApplicabilityChange(saturdays, utc("2026-10-30T16:00:00Z"), NEW_YORK),
    ).toBe(utc("2026-10-31T04:00:00Z"));
  });

  it("is always strictly later than the instant it starts from", () => {
    const evening = conditions({
      window: { startMinute: at("18:00"), endMinute: at("23:00") },
    });
    const exactlyAtStart = utc("2026-01-02T18:00:00Z");
    expect(
      nextApplicabilityChange(evening, exactlyAtStart, "UTC"),
    ).toBeGreaterThan(exactlyAtStart);
    const midMinute = utc("2026-01-02T17:59:30Z");
    expect(nextApplicabilityChange(evening, midMinute, "UTC")).toBe(
      exactlyAtStart,
    );
  });

  it("stops at a DST transition rather than stepping over a changed local time", () => {
    // Spring-forward at 2026-03-08T07:00Z jumps 02:00 EST to 03:00 EDT, so a
    // 02:30 window start computed at the old offset never happens; the
    // transition itself is where applicability may change.
    const early = conditions({
      window: { startMinute: at("02:30"), endMinute: at("04:00") },
    });
    expect(
      nextApplicabilityChange(early, utc("2026-03-08T06:00:00Z"), NEW_YORK),
    ).toBe(utc("2026-03-08T07:00:00Z"));
  });

  it("never steps past an instant where applicability actually changes", () => {
    const rule = conditions({
      dates: { kind: "annual", startMonthDay: "11-01", endMonthDay: "03-15" },
      weekdays: [FRIDAY, SATURDAY],
      window: { startMinute: at("22:00"), endMinute: at("02:30") },
    });
    // Walk minute by minute across both 2026 New York DST changes.
    for (const [from, to] of [
      ["2026-03-06T00:00:00Z", "2026-03-10T00:00:00Z"],
      ["2026-10-30T00:00:00Z", "2026-11-03T00:00:00Z"],
    ] as const) {
      let instant = utc(from);
      let applies = appliesAt(rule, instant, NEW_YORK);
      let next = nextApplicabilityChange(rule, instant, NEW_YORK);
      while (instant < utc(to)) {
        instant += 60_000;
        const now = appliesAt(rule, instant, NEW_YORK);
        if (now !== applies) expect(instant).toBeGreaterThanOrEqual(next);
        if (instant >= next) {
          next = nextApplicabilityChange(rule, instant, NEW_YORK);
        }
        applies = now;
      }
    }
  });
});
