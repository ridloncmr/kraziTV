// Desktop shell state only: whether the TMDB balloon may open by itself in
// this browser. It never reaches the server or changes enrichment.
const STORAGE_KEY = "krazitv.tmdbReminder";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1_000;

/** What the owner last chose: a snooze end, or never again. */
type ReminderState = { remindAfter: number } | { never: true };

/** Reads the stored choice; missing, unreadable, or blocked storage counts as none. */
function readState(): ReminderState | undefined {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
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
function writeState(state: ReminderState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Private windows may refuse storage; reminding again is harmless. */
  }
}

/** Whether the balloon may open by itself at `now`. */
export function isReminderDue(now: number): boolean {
  const state = readState();
  if (state === undefined) return true;
  return "never" in state ? false : now >= state.remindAfter;
}

/** **Remind me later**, ✕, and **Set up TMDB**: wait 7 days from `now`. */
export function snoozeReminder(now: number): void {
  writeState({ remindAfter: now + SNOOZE_MS });
}

/** **Don't remind me**: the balloon never opens by itself again here. */
export function stopReminder(): void {
  writeState({ never: true });
}
