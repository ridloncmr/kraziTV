// Desktop shell state only: whether a tray reminder's balloon may open by
// itself in this browser. Each reminder keeps its choice under its own key,
// in the shape the TMDB reminder always used, so one answer never silences
// another. A reminder that counts what it found also stores the count it was
// answered at, or, for **Remind me after**, the number of new ones to wait
// for and the fewest it has seen since (decision 24). It never reaches the
// server or changes enrichment.
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * What the owner last chose: a snooze end, with the count a counting
 * reminder was answered at; a number of new ones to wait for, counted from
 * the fewest seen since; or never again.
 */
type ReminderState =
  | { remindAfter: number; answeredCount?: number }
  | { afterNew: number; lowestSeen: number }
  | { never: true };

/** Whether a stored value is a count: a whole number, zero or more. */
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Reads the stored choice; missing, unreadable, or blocked storage counts as none. */
function readState(storageKey: string): ReminderState | undefined {
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    ) as unknown;
    if (typeof value !== "object" || value === null) return undefined;
    if ("never" in value && value.never === true) return { never: true };
    if (
      "afterNew" in value &&
      isCount(value.afterNew) &&
      value.afterNew > 0 &&
      "lowestSeen" in value &&
      isCount(value.lowestSeen)
    )
      return { afterNew: value.afterNew, lowestSeen: value.lowestSeen };
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
 * back on its own. **Remind me after** has no snooze: it is due once the
 * count is that many above the fewest seen since.
 */
export function isReminderDue(
  storageKey: string,
  now: number,
  count?: number,
): boolean {
  const state = readState(storageKey);
  if (state === undefined) return true;
  if ("never" in state) return false;
  if ("afterNew" in state)
    return count !== undefined && count >= state.lowestSeen + state.afterNew;
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

/**
 * **Remind me after**: wait for `afterNew` new ones, counted from the
 * `count` still to decide now, with no 7-day wait.
 */
export function remindAfterNew(
  storageKey: string,
  afterNew: number,
  count: number,
): void {
  writeState(storageKey, { afterNew, lowestSeen: count });
}

/**
 * Lowers a **Remind me after** answer's fewest seen to `count` when fewer
 * are left, so new ones are counted from there and deciding the ones the
 * balloon showed never holds it back. Any other answer is left alone. Only
 * a count the shell actually read may reach it, never a guess of 0.
 */
export function recordCountSeen(storageKey: string, count: number): void {
  const state = readState(storageKey);
  if (state === undefined || !("afterNew" in state)) return;
  if (count < state.lowestSeen)
    writeState(storageKey, { ...state, lowestSeen: count });
}

/** **Don't remind me**: the balloon never opens by itself again here. */
export function stopReminder(storageKey: string): void {
  writeState(storageKey, { never: true });
}
