/**
 * Which local calendar dates a rule covers (programming spec 0005). One-off
 * dates are `YYYY-MM-DD` and annual ones `MM-DD`; both endpoints are
 * inclusive, and an annual range whose start follows its end crosses the
 * year end.
 */
export type DateCondition =
  | { kind: "any" }
  | { kind: "one_off"; startDate: string; endDate: string }
  | { kind: "annual"; startMonthDay: string; endMonthDay: string };

/**
 * A half-open local time-of-day window in minutes after midnight, 0 to
 * 1439. An end before the start crosses midnight; the hours after midnight
 * belong to the date and weekday the window started on.
 */
interface TimeWindow {
  startMinute: number;
  endMinute: number;
}

/**
 * A rule's calendar conditions, combined with AND; an unset condition is
 * unrestricted.
 */
export interface CalendarConditions {
  dates: DateCondition;
  /** Local weekdays, 0 for Sunday through 6 for Saturday; null means every day. */
  weekdays: readonly number[] | null;
  /** Null means the whole applicable day. */
  window: TimeWindow | null;
}

/** An instant as the programming timezone's wall clock shows it. */
export interface LocalTime {
  /** `YYYY-MM-DD`. */
  date: string;
  /** 0 for Sunday through 6 for Saturday. */
  weekday: number;
  /** Minutes after local midnight, 0 to 1439. */
  minute: number;
}
