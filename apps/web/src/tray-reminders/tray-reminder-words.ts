import { displayCount } from "../controls/formatting/display-count.js";
import type { TrayReminderWords, TrayStatusWords } from "./contracts.js";

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

/**
 * The tray's status while lookups run (spec 0006, Lookups running): files
 * looked up so far of every file the running jobs look up, counted as the
 * rest of the app counts.
 */
export function lookupsRunningWords(
  done: number,
  total: number,
): TrayStatusWords {
  return {
    title: `Looking up files on TMDB: ${displayCount(done)} of ${displayCount(total)}`,
    sentence:
      "kraziTV is looking your files up on TMDB. Keep working; the tray will tell you when it's done.",
    quip: "It's being processed. Everything is always being processed.",
  };
}

/** The words every balloon shares: its answers beside the main action, and Gregg's name. */
export const BALLOON_WORDS = {
  later: "Remind me later",
  never: "Don't remind me",
  close: "Close",
  /** The name the drawing beside the title carries for assistive technology. */
  assistant: "Gregg",
};
