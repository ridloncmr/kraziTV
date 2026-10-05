// Deterministic Plex settings for tests only; production code must never import this module.
import type { PlexSettings } from "../plex/plex-routes.js";

/**
 * Plex settings for servers whose tests do not care about them. The base is
 * deliberately not the production default, so a test that leaks a URL shows
 * where it came from.
 */
export const plexSettingsFixture: PlexSettings = {
  publicBaseUrl: "http://krazitv.test",
};
