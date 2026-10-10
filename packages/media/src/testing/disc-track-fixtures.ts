import { derivePathHints } from "../path-hints/derive-path-hints.js";
import { discTrack } from "../path-hints/disc-track.js";
import type { PathPlatform } from "../paths/media-path.js";
// The disc-track place of a root-relative path.
export function trackOf(
  relativePath: string,
  platform: PathPlatform = "win32",
) {
  return discTrack(derivePathHints(relativePath.split("/")), platform);
}
