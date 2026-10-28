// Wire shape of the Plex setup the server advertises.
export interface PlexSetup {
  tunerBaseUrl: string;
  xmltvUrl: string;
  /** Server settings that name this computer only, so Plex elsewhere cannot connect. */
  localOnlySettings: ("PUBLIC_BASE_URL" | "HOST")[];
  /** This computer's network address, the public base URL to suggest, if it has one. */
  suggestedPublicBaseUrl: string | null;
}
