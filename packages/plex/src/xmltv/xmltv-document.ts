import { escapeXml } from "./escape-xml.js";
import { formatXmltvTime } from "./xmltv-time.js";

/** One schedule entry as the guide lists it, with instants in epoch milliseconds. */
interface GuideProgramme {
  startsAt: number;
  endsAt: number;
  title: string;
}

/** One enabled channel in lineup order, with the programmes its guide lists. */
interface GuideChannel {
  id: string;
  number: string;
  name: string;
  programmes: readonly GuideProgramme[];
}

/**
 * Builds the XMLTV document Plex loads as its guide. Channel IDs come from the
 * stable channel ID, so renumbering never breaks Plex's guide mapping. Plex
 * shows the first display name, so the name comes before the number. Every
 * channel is declared before any programme, as the XMLTV DTD requires.
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
  for (const channel of channels) {
    for (const programme of channel.programmes) {
      lines.push(
        `  <programme start="${formatXmltvTime(programme.startsAt)}" stop="${formatXmltvTime(programme.endsAt)}" channel="${xmltvChannelId(channel.id)}">`,
        `    <title>${escapeXml(programme.title)}</title>`,
        "  </programme>",
      );
    }
  }
  lines.push("</tv>", "");
  return lines.join("\n");
}

// The Plex-facing guide ID for a channel; programmes reference the same value.
function xmltvChannelId(channelId: string): string {
  return escapeXml(`${channelId}.krazitv`);
}
