import type { CalendarConditions, DateCondition } from "./contracts.js";

const LAST_MINUTE = 24 * 60 - 1;

/**
 * Why calendar conditions are invalid, and the condition field it concerns,
 * as a path such as `["dates", "endDate"]`, so a refusal can name the field
 * the owner must change.
 */
type CalendarProblem = { field: string[]; message: string };

/** One problem about the field at `field`. */
function problem(message: string, ...field: string[]): CalendarProblem {
  return { field, message };
}

/**
 * Returns why a rule's calendar conditions are invalid, and where, or null when they
 * are valid: real dates and days of the year, a one-off range that does
 * not end before it starts, at least one distinct weekday from 0 to 6 when
 * weekdays are named, and a window of whole minutes that does not start and
 * end together. The one calendar rule, so the API asks it rather than
 * restating it.
 */
export function findCalendarProblem({
  dates,
  weekdays,
  window,
}: CalendarConditions): CalendarProblem | null {
  const dateProblem = findDateProblem(dates);
  if (dateProblem !== null) return dateProblem;
  if (weekdays !== null) {
    if (weekdays.length === 0)
      return problem("weekdays must name at least one day", "weekdays");
    if (weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      return problem(
        "weekdays must be 0 (Sunday) through 6 (Saturday)",
        "weekdays",
      );
    }
    if (new Set(weekdays).size !== weekdays.length) {
      return problem("weekdays must not repeat a day", "weekdays");
    }
  }
  if (window !== null) {
    const minutes = [window.startMinute, window.endMinute];
    if (
      minutes.some(
        (minute) =>
          !Number.isInteger(minute) || minute < 0 || minute > LAST_MINUTE,
      )
    ) {
      return problem(
        "window minutes must be whole minutes from 0 through 1439",
        "window",
      );
    }
    if (window.startMinute === window.endMinute) {
      return problem(
        "a window must not start and end at the same minute",
        "window",
        "endMinute",
      );
    }
  }
  return null;
}

/** Returns why a date condition names a day that does not exist, or null. */
function findDateProblem(dates: DateCondition): CalendarProblem | null {
  switch (dates.kind) {
    case "any":
      return null;
    case "one_off":
      if (!isRealDate(dates.startDate)) {
        return problem(
          "startDate must be a real YYYY-MM-DD date",
          "dates",
          "startDate",
        );
      }
      if (!isRealDate(dates.endDate)) {
        return problem(
          "endDate must be a real YYYY-MM-DD date",
          "dates",
          "endDate",
        );
      }
      return dates.endDate < dates.startDate
        ? problem("endDate must not be before startDate", "dates", "endDate")
        : null;
    case "annual":
      // A leap year accepts February 29, which non-leap years read as the 28th.
      if (!isRealDate(`2028-${dates.startMonthDay}`)) {
        return problem(
          "startMonthDay must be a real MM-DD day of the year",
          "dates",
          "startMonthDay",
        );
      }
      return isRealDate(`2028-${dates.endMonthDay}`)
        ? null
        : problem(
            "endMonthDay must be a real MM-DD day of the year",
            "dates",
            "endMonthDay",
          );
  }
}

/** Whether `YYYY-MM-DD` names a calendar date that exists. */
function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return (
    !Number.isNaN(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === date
  );
}
