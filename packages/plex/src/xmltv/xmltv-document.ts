import { escapeXml } from "./escape-xml.js";

/** One enabled channel in lineup order, as the guide declares it. */
interface GuideChannel {
  id: string;
  number: string;
  name: string;
}

/**
 * Builds the XMLTV document Plex loads as its guide. Channel IDs come from the
 * stable channel ID, so renumbering never breaks Plex's guide mapping. Plex
 * shows the first display name, so the name comes before the number.
 */
export function formatXmltv(channels: readonly GuideChannel[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE tv SYSTEM "xmltv.dtd">',
    '<tv generator-info-name="kraziTV">',
  ];
  for (const channel of channels) {
    lines.push(
      `  <channel id="${xmltvChannelId(channel.id)}">`,
      `    <display-name>${escapeXml(channel.name)}</display-name>`,
      `    <display-name>${escapeXml(channel.number)}</display-name>`,
      "  </channel>",
    );
  }
  lines.push("</tv>", "");
  return lines.join("\n");
}

// The Plex-facing guide ID for a channel; programmes reference the same value.
function xmltvChannelId(channelId: string): string {
  return escapeXml(`${channelId}.krazitv`);
}
