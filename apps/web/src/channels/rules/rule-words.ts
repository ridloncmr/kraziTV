import type { ProgrammingRule } from "../../http/contracts/programming.js";

/** Local weekday names, 0 for Sunday, as rules number them. */
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A rule on one weekday reads as that day every week.
const EVERY_WEEKDAY = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

// Rule dates and times are wall-clock values in the programming timezone,
// so they format as UTC to show exactly the digits saved.
const monthDayFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const fullDateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/**
 * Says when a rule applies in the words the owner reads in the Rules list,
 * such as `Every year, Dec 1 – Dec 31 · Fridays · 6:00 PM – 11:00 PM`.
 * Conditions combine, so each one present is one part; a rule with none
 * applies at any time.
 */
export function describeWhen(rule: ProgrammingRule): string {
  const parts = [
    datesWords(rule.dates),
    daysWords(rule.weekdays),
    rule.window &&
      `${clockWords(rule.window.startMinute)} – ${clockWords(rule.window.endMinute)}`,
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join(" · ") : "Any time";
}

/** Says what a rule does to the lineup while it applies. */
export function behaviorWords(behavior: ProgrammingRule["behavior"]): string {
  return behavior === "join"
    ? "Mixes into the lineup"
    : "Takes over the channel";
}

// Words a rule's date condition, or nothing when it applies on any date.
function datesWords(dates: ProgrammingRule["dates"]): string | null {
  if (dates.kind === "one_off") {
    return `${fullDateFormat.format(isoDate(dates.startDate))} – ${fullDateFormat.format(isoDate(dates.endDate))}`;
  }
  if (dates.kind === "annual") {
    const monthDay = (value: string) =>
      monthDayFormat.format(isoDate(`2000-${value}`));
    return `Every year, ${monthDay(dates.startMonthDay)} – ${monthDay(dates.endMonthDay)}`;
  }
  return null;
}

// Words a rule's weekdays, naming the two common sets, or nothing for every day.
function daysWords(weekdays: readonly number[] | null): string | null {
  if (weekdays === null || weekdays.length === 7) return null;
  const key = [...weekdays].sort().join("");
  if (key === "12345") return "Weekdays";
  if (key === "06") return "Weekends";
  if (weekdays.length === 1) return EVERY_WEEKDAY[weekdays[0] ?? 0] ?? null;
  return [...weekdays]
    .sort()
    .map((day) => WEEKDAYS[day])
    .join(", ");
}

// A local minute after midnight as a clock time, such as 6:00 PM.
function clockWords(minute: number): string {
  return clockFormat.format(
    Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60),
  );
}

// A `YYYY-MM-DD` date as the UTC midnight that formats to its own digits.
function isoDate(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year ?? 2000, (month ?? 1) - 1, day ?? 1);
}
