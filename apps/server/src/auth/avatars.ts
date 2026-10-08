/** The avatar a new account starts with; always the first built-in ID. */
export const DEFAULT_AVATAR_ID = "duck";

/**
 * Every built-in avatar ID, in the web app's picker order (spec 0003). The
 * web app owns the drawings; a web test keeps the two lists equal.
 */
export const AVATAR_IDS: readonly string[] = [
  DEFAULT_AVATAR_ID,
  "crt-tv",
  "antenna",
  "remote",
  "film-reel",
  "popcorn",
  "guitar",
  "chess",
];
