// Deterministic Plex settings for tests only; production code must never import this module.
import type { PlexSettings } from "../plex/plex-routes.js";

/**
 * Plex settings for servers whose tests do not care about them. Each value
 * differs from the production default, so a leaked value shows where it came from.
 */
export const plexSettingsFixture: PlexSettings = {
  publicBaseUrl: "http://krazitv.test",
  deviceId: "FEEDC0DE",
  tunerCount: 3,
  listenHost: "0.0.0.0",
  // A documentation address, so it never names a real machine.
  networkBaseUrl: "http://192.0.2.10:3000",
};
