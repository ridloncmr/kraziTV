import type { Recommendation } from "../http/contracts/collections.js";
import type { MediaRoot } from "../http/contracts/media.js";
import { bootDesktop } from "./auth-fixtures.js";
import { idleRoot } from "./scan-fixtures.js";

/**
 * A settled library for `bootTray`: a key set, no job running, and nothing
 * left to look up, the one time the shell reads recommendations.
 */
export const SETTLED_LIBRARY = { configured: true, roots: [idleRoot("a")] };

/**
 * Boots the desktop with the server reporting what the tray reminders read:
 * whether a TMDB key is `configured`, the media `roots`, and, when given,
 * the collection `recommendations`. Returns once the shell has asked for the
 * roots, which it asks for after the key.
 */
export async function bootTray({
  configured,
  roots,
  recommendations,
}: {
  configured: boolean;
  roots: readonly MediaRoot[];
  recommendations?: readonly Recommendation[];
}) {
  return bootDesktop(undefined, (scripted) => {
    scripted.reply("/metadata/tmdb-key", { configured });
    scripted.reply("/media-roots", roots);
    if (recommendations)
      scripted.reply("/media-collections/recommendations", recommendations);
  });
}
