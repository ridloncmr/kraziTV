import type { TrayReminderWords } from "./contracts.js";

/**
 * Reminder 1, TMDB isn't set up (spec 0006). Its title, sentence, and
 * button carry over from the TMDB balloon unchanged; Gregg's quip is new.
 */
export const TMDB_REMINDER_WORDS: TrayReminderWords = {
  title: "TMDB isn't set up",
  sentence:
    "kraziTV can only read titles from file names. Set up TMDB to look up series, episodes, and movies.",
  quip: "Right now I'm reading titles off file names. Nobody should live like this.",
  action: "Set up TMDB",
};

/** The words every balloon shares: its answers beside the main action, and Gregg's name. */
export const BALLOON_WORDS = {
  later: "Remind me later",
  never: "Don't remind me",
  close: "Close",
  /** The name the drawing beside the title carries for assistive technology. */
  assistant: "Gregg",
};
