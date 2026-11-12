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
 * What the tray says about work under way, such as running lookups (spec
 * 0006): the icon carries its title only while no reminder shows, and its
 * balloon opens only when asked, offers only ✕, and stores nothing.
 */
export type TrayStatusWords = Omit<TrayReminderWords, "action">;

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
  /**
   * How many things it found, for a reminder that is due again only when
   * there are more than when the owner last answered it (decision 24);
   * stored with each answer. A reminder with a count also offers **Remind me
   * after** a number of new ones. Undefined for a reminder that ignores
   * counts, and while the count is not known, such as while files are left
   * to look up or the read made for the latest settle has not answered.
   */
  count?: number;
  /** The main action, run after the balloon closes and snoozes. */
  act: () => void;
}
