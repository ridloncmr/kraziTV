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
 * Reminder 2, Files not looked up (spec 0006): how many files no lookup has
 * searched for yet, its title and sentence worded for one file or several.
 * The button keeps the spec's one name, **Look them up**, whatever the
 * count, so the wiki and any advice name one action.
 */
export function filesNotLookedUpWords(count: number): TrayReminderWords {
  const one = count === 1;
  return {
    title: one
      ? "1 file hasn't been looked up on TMDB"
      : `${displayCount(count)} files haven't been looked up on TMDB`,
    sentence: one
      ? "Look it up so kraziTV can name its show and suggest collections."
      : "Look them up so kraziTV can name their shows and suggest collections.",
    quip: "Paperwork doesn't file itself. I've checked.",
    action: "Look them up",
  };
}

/**
 * Reminder 3, Collections ready (spec 0006): the recommendations still to
 * decide, series counted as shows and franchises as movie series, leaving
 * out a kind with none; "series" reads the same for one or several.
 */
export function collectionsReadyWords(
  shows: number,
  movieSeries: number,
): TrayReminderWords {
  const found = [
    shows > 0 && `${displayCount(shows)} ${shows === 1 ? "show" : "shows"}`,
    movieSeries > 0 && `${displayCount(movieSeries)} movie series`,
  ].filter(Boolean);
  return {
    title: `kraziTV found ${found.join(" and ")}`,
    sentence:
      shows + movieSeries === 1
        ? "Make it into a collection, then put it on a channel."
        : "Make them into collections, then put them on a channel.",
    quip: "I sorted your whole library. No, nobody thanked me either.",
    action: "Make collections",
  };
}

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
