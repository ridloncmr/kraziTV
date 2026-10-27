/** The guide shows the next day: its window runs 24 hours from the anchor. */
const GUIDE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Four pixels a minute, so a half hour is 120px: room to read a title. */
const PX_PER_MINUTE = 4;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** The whole window's width in pixels. */
export const GUIDE_WIDTH_PX = (GUIDE_WINDOW_MS / MINUTE_MS) * PX_PER_MINUTE;

/** Where an instant falls: pixels from the window's start, negative before it and past the width after it. */
export function offsetPx(instant: number, windowStart: number): number {
  return ((instant - windowStart) / MINUTE_MS) * PX_PER_MINUTE;
}

/** A block's left edge and width, clipped to the window; null when none of it falls inside. */
export function placeBlock(
  startsAt: string,
  endsAt: string,
  windowStart: number,
): { left: number; width: number } | null {
  const left = Math.max(0, offsetPx(Date.parse(startsAt), windowStart));
  const right = Math.min(
    GUIDE_WIDTH_PX,
    offsetPx(Date.parse(endsAt), windowStart),
  );
  return right > left ? { left, width: right - left } : null;
}

/** Every whole local hour inside the window, with where it falls, for the ruler across the top. */
export function hourMarks(
  windowStart: number,
): { instant: number; left: number }[] {
  const first = new Date(windowStart);
  first.setMinutes(0, 0, 0);
  const marks = [];
  for (
    let instant = first.getTime();
    instant < windowStart + GUIDE_WINDOW_MS;
    instant += HOUR_MS
  ) {
    if (instant >= windowStart)
      marks.push({ instant, left: offsetPx(instant, windowStart) });
  }
  return marks;
}
