// Desktop shell state only: whether a tray reminder's balloon may open by
// itself in this browser. Each reminder keeps its choice under its own key,
// in the shape the TMDB reminder always used, so one answer never silences
// another. It never reaches the server or changes enrichment.
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1_000;

/** What the owner last chose: a snooze end, or never again. */
type ReminderState = { remindAfter: number } | { never: true };

/** Reads the stored choice; missing, unreadable, or blocked storage counts as none. */
function readState(storageKey: string): ReminderState | undefined {
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    ) as unknown;
    if (typeof value !== "object" || value === null) return undefined;
    if ("never" in value && value.never === true) return { never: true };
    if ("remindAfter" in value && typeof value.remindAfter === "number")
      return { remindAfter: value.remindAfter };
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

/** Whether the reminder's balloon may open by itself at `now`. */
export function isReminderDue(storageKey: string, now: number): boolean {
  const state = readState(storageKey);
  if (state === undefined) return true;
  return "never" in state ? false : now >= state.remindAfter;
}

/** **Remind me later**, ✕, Escape, and the main action: wait 7 days from `now`. */
export function snoozeReminder(storageKey: string, now: number): void {
  writeState(storageKey, { remindAfter: now + SNOOZE_MS });
}

/** **Don't remind me**: the balloon never opens by itself again here. */
export function stopReminder(storageKey: string): void {
  writeState(storageKey, { never: true });
}
