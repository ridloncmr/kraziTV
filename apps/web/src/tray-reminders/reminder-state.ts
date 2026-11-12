// Desktop shell state only: whether a tray reminder's balloon may open by
// itself in this browser. Each reminder keeps its choice under its own key,
// in the shape the TMDB reminder always used, so one answer never silences
// another. A reminder that counts what it found also stores the count it was
// answered at (decision 24). It never reaches the server or changes
// enrichment.
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * What the owner last chose: a snooze end, with the count a counting
 * reminder was answered at, or never again.
 */
type ReminderState =
  { remindAfter: number; answeredCount?: number } | { never: true };

/** Reads the stored choice; missing, unreadable, or blocked storage counts as none. */
function readState(storageKey: string): ReminderState | undefined {
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    ) as unknown;
    if (typeof value !== "object" || value === null) return undefined;
    if ("never" in value && value.never === true) return { never: true };
    if ("remindAfter" in value && typeof value.remindAfter === "number")
      return "answeredCount" in value && typeof value.answeredCount === "number"
        ? { remindAfter: value.remindAfter, answeredCount: value.answeredCount }
        : { remindAfter: value.remindAfter };
  } catch {
    /* Unreadable state counts as due. */
  }
  return undefined;
}

/** Stores the owner's choice; blocked storage just means the balloon returns next start. */
function writeState(storageKey: string, state: ReminderState): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* Private windows may refuse storage; reminding again is harmless. */
  }
}

/**
 * Whether the reminder's balloon may open by itself at `now`. Given a
 * `count`, its snooze must be over and the count must be higher than the
 * one last answered, so what the owner has already seen never brings it
 * back on its own.
 */
export function isReminderDue(
  storageKey: string,
  now: number,
  count?: number,
): boolean {
  const state = readState(storageKey);
  if (state === undefined) return true;
  if ("never" in state) return false;
  return (
    now >= state.remindAfter &&
    (count === undefined || count > (state.answeredCount ?? 0))
  );
}

/**
 * **Remind me later**, ✕, Escape, and the main action: wait 7 days from
 * `now`, and remember the `count` answered, if the reminder counts.
 */
export function snoozeReminder(
  storageKey: string,
  now: number,
  count?: number,
): void {
  writeState(
    storageKey,
    count === undefined
      ? { remindAfter: now + SNOOZE_MS }
      : { remindAfter: now + SNOOZE_MS, answeredCount: count },
  );
}

/** **Don't remind me**: the balloon never opens by itself again here. */
export function stopReminder(storageKey: string): void {
  writeState(storageKey, { never: true });
}
