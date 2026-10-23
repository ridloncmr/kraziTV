import { expect, it } from "vitest";
import { ruleFixture } from "../../testing/admin-fixtures.js";
import { describeWhen } from "./rule-words.js";

// A rule with only the conditions a test sets.
const when = (overrides: Parameters<typeof ruleFixture>[3]) =>
  describeWhen(ruleFixture("rule", "Rule", [], overrides));

it("says a rule without conditions applies at any time", () => {
  expect(when({})).toBe("Any time");
});

it("joins each condition a rule has, in dates, days, hours order", () => {
  expect(
    when({
      dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "12-31" },
      weekdays: [5],
      window: { startMinute: 18 * 60, endMinute: 23 * 60 + 30 },
    }),
  ).toBe("Every year, Dec 1 – Dec 31 · Fridays · 6:00 PM – 11:30 PM");
});

it("shows a one-off range with its years, exactly as saved", () => {
  expect(
    when({
      dates: {
        kind: "one_off",
        startDate: "2026-12-31",
        endDate: "2027-01-01",
      },
    }),
  ).toBe("Dec 31, 2026 – Jan 1, 2027");
});

it("names weekdays and weekends, and lists any other days in week order", () => {
  expect(when({ weekdays: [1, 2, 3, 4, 5] })).toBe("Weekdays");
  expect(when({ weekdays: [6, 0] })).toBe("Weekends");
  expect(when({ weekdays: [6, 1, 3] })).toBe("Mon, Wed, Sat");
  expect(when({ weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe("Any time");
});
