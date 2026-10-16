import type { LocalTime } from "./contracts.js";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// One formatter per timezone; building one is far slower than using it.
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Returns the numeric wall-clock formatter for a timezone. Latin digits and
 * a 23-hour cycle keep every field a plain integer on every runtime.
 */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US-u-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Reads an instant's local wall-clock fields as the UTC milliseconds of
 * that same wall-clock reading, to the minute. Subtracting the instant
 * gives the timezone's offset there.
 */
function wallClockMs(instant: number, timeZone: string): number {
  const fields: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return Date.UTC(
    fields.year ?? 0,
    (fields.month ?? 1) - 1,
    fields.day ?? 1,
    fields.hour ?? 0,
    fields.minute ?? 0,
  );
}

/**
 * Converts a UTC instant to the timezone's local date, weekday, and minute
 * of the day. The one conversion calendar rules use, so DST behaves the
 * same everywhere: a repeated local time maps from both of its instants,
 * and a skipped one from none.
 */
export function toLocalTime(instant: number, timeZone: string): LocalTime {
  const wall = wallClockMs(instant, timeZone);
  const day = new Date(wall);
  return {
    date: day.toISOString().slice(0, 10),
    weekday: day.getUTCDay(),
    minute: Math.floor((wall % DAY_MS) / MINUTE_MS),
  };
}

/**
 * The timezone's offset from UTC in milliseconds at an instant, from the
 * instant's minute so seconds never count as offset.
 */
export function offsetAt(instant: number, timeZone: string): number {
  const minute = Math.floor(instant / MINUTE_MS) * MINUTE_MS;
  return wallClockMs(minute, timeZone) - minute;
}

/** The `YYYY-MM-DD` calendar date before `date`. */
export function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS)
    .toISOString()
    .slice(0, 10);
}
