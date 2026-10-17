import type { PlaybackMode } from "../http/contracts.js";

/**
 * Every playback mode with the words My Channels shows for it, so an
 * assignment and a special name and explain a mode the same way.
 */
export const PLAYBACK_MODE_CHOICES: readonly {
  mode: PlaybackMode;
  label: string;
  hint: string;
}[] = [
  {
    mode: "chronological",
    label: "Collection order",
    hint: "Plays the collection in its saved order.",
  },
  {
    mode: "episode",
    label: "Episode order",
    hint: "Plays by series, season, and episode; items without episode details play last, in saved order.",
  },
  {
    mode: "release",
    label: "Release order",
    hint: "Plays by release or air date, earliest first; items without a date play last, in saved order.",
  },
  {
    mode: "random",
    label: "Random",
    hint: "Picks reproducibly at random from the collection; items can repeat.",
  },
];
