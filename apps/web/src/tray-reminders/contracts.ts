/** What one reminder's balloon and tray icon say. */
export interface TrayReminderWords {
  /** The balloon's title, and the tray icon's name and tooltip while it leads. */
  title: string;
  /** What is wrong and what the main action does, without Gregg's help. */
  sentence: string;
  /** Gregg's one extra line under the title; never the only explanation. */
  quip: string;
  /** The main action's button label. */
  action: string;
}

/**
 * One tray reminder as the shell evaluates it now (spec 0006, Tray
 * reminders): its words, whether it shows and holds, and its main action.
 * The tray shows the first reminder in the list that shows.
 */
export interface TrayReminder {
  /** Where this browser keeps the owner's choice; also tells reminders apart. */
  storageKey: string;
  words: TrayReminderWords;
  /** Whether the tray icon carries it, so the owner can always open it. */
  shows: boolean;
  /** Whether its condition holds, so its balloon may open by itself; implies `shows`. */
  holds: boolean;
  /** The main action, run after the balloon closes and snoozes. */
  act: () => void;
}
