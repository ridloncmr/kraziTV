import type {
  CalendarConditions,
  DateCondition,
  LocalTime,
} from "./contracts.js";
import { offsetAt, previousDate, toLocalTime } from "./local-time.js";

const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 24 * 60;

/**
 * Whether a rule's calendar conditions all hold at a UTC instant in the
 * programming timezone (programming spec 0005). A window crossing midnight
 * belongs to the date and weekday it started on, so its hours after
 * midnight are judged by the day before.
 */
export function appliesAt(
  conditions: CalendarConditions,
  instant: number,
  timeZone: string,
): boolean {
  const local = toLocalTime(instant, timeZone);
  const { window } = conditions;
  if (window === null) return dayApplies(conditions, local);
  const { startMinute, endMinute } = window;
  if (startMinute < endMinute) {
    return (
      local.minute >= startMinute &&
      local.minute < endMinute &&
      dayApplies(conditions, local)
    );
  }
  if (local.minute >= startMinute) return dayApplies(conditions, local);
  if (local.minute >= endMinute) return false;
  return dayApplies(conditions, {
    date: previousDate(local.date),
    weekday: (local.weekday + 6) % 7,
    minute: local.minute,
  });
}

/**
 * Returns the earliest instant after `from` where the conditions' result
 * may change: the next local midnight, window start, or window end, or an
 * earlier change of the timezone's offset, which moves every local time.
 * The result is constant from `from` up to it, so generation can step there
 * instead of evaluating every minute.
 */
export function nextApplicabilityChange(
  conditions: CalendarConditions,
  from: number,
  timeZone: string,
): number {
  const { minute } = toLocalTime(from, timeZone);
  const boundaries =
    conditions.window === null
      ? [0]
      : [0, conditions.window.startMinute, conditions.window.endMinute];
  const ahead = Math.min(
    ...boundaries.map(
      (boundary) =>
        (boundary - minute + MINUTES_PER_DAY) % MINUTES_PER_DAY ||
        MINUTES_PER_DAY,
    ),
  );
  const minuteStart = Math.floor(from / MINUTE_MS) * MINUTE_MS;
  const candidate = minuteStart + ahead * MINUTE_MS;
  const offset = offsetAt(from, timeZone);
  if (offsetAt(candidate, timeZone) === offset) return candidate;
  // The offset changes before the candidate: find its first minute.
  let unchanged = minuteStart;
  let changed = candidate;
  while (changed - unchanged > MINUTE_MS) {
    const middle =
      unchanged + Math.floor((changed - unchanged) / 2 / MINUTE_MS) * MINUTE_MS;
    if (offsetAt(middle, timeZone) === offset) unchanged = middle;
    else changed = middle;
  }
  return changed;
}

/** Whether a local day meets the date and weekday conditions. */
function dayApplies(
  { dates, weekdays }: CalendarConditions,
  local: LocalTime,
): boolean {
  return (
    (weekdays === null || weekdays.includes(local.weekday)) &&
    dateApplies(dates, local.date)
  );
}

/**
 * Whether a local date falls in a date condition. Annual endpoints are
 * read in the date's own year, where February 29 becomes February 28 when
 * the year has none.
 */
function dateApplies(dates: DateCondition, date: string): boolean {
  switch (dates.kind) {
    case "any":
      return true;
    case "one_off":
      return dates.startDate <= date && date <= dates.endDate;
    case "annual": {
      const year = Number(date.slice(0, 4));
      const monthDay = date.slice(5);
      const start = inYear(dates.startMonthDay, year);
      const end = inYear(dates.endMonthDay, year);
      return start <= end
        ? start <= monthDay && monthDay <= end
        : monthDay >= start || monthDay <= end;
    }
  }
}

/** An annual `MM-DD` endpoint as it falls in `year`. */
function inYear(monthDay: string, year: number): string {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return monthDay === "02-29" && !leap ? "02-28" : monthDay;
}
