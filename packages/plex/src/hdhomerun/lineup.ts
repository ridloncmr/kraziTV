/** One enabled channel in lineup order, with its absolute stream URL already built. */
interface LineupChannel {
  number: string;
  name: string;
  streamUrl: string;
}

/** One HDHomeRun lineup entry; these are the fields Plex reads. */
interface LineupEntry {
  GuideNumber: string;
  GuideName: string;
  URL: string;
}

/**
 * Maps channels to HDHomeRun lineup entries in the order given. Fields are
 * copied one by one so extra properties on a caller's record never reach Plex.
 */
export function formatLineup(
  channels: readonly LineupChannel[],
): LineupEntry[] {
  return channels.map((channel) => ({
    GuideNumber: channel.number,
    GuideName: channel.name,
    URL: channel.streamUrl,
  }));
}
