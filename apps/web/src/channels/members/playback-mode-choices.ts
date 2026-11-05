import type { PlaybackMode } from "../../http/contracts/programming.js";

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
    hint: "Plays top to bottom, in the order the collection is saved.",
  },
  {
    mode: "episode",
    label: "Episode order",
    hint: "Plays season by season, episode by episode. Anything without season and episode numbers plays last.",
  },
  {
    mode: "release",
    label: "Release order",
    hint: "Plays oldest first, by release or air date. Anything without a date plays last.",
  },
  {
    mode: "random",
    label: "Random",
    hint: "Picks at random each time, so things can repeat.",
  },
];

/**
 * The words My Channels shows for a playback mode, so every screen that names
 * one reads it from the same list; a mode the list lacks shows as sent.
 */
export function playbackModeLabel(mode: PlaybackMode): string {
  return (
    PLAYBACK_MODE_CHOICES.find((choice) => choice.mode === mode)?.label ?? mode
  );
}
