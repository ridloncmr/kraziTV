import { escapeXml } from "./escape-xml.js";
import { formatXmltvTime } from "./xmltv-time.js";

/**
 * One schedule entry as the guide lists it, with instants in epoch
 * milliseconds. Everything past the title is optional: a programme whose
 * media has no content metadata lists as title and times alone.
 */
export interface GuideProgramme {
  startsAt: number;
  endsAt: number;
  title: string;
  /** An episode's own title, under the series title. */
  subTitle?: string | null;
  description?: string | null;
  /** First air or release as XMLTV writes it: `YYYY`, `YYYYMM`, or `YYYYMMDD`. */
  date?: string | null;
  /** Guide categories such as `Movie` or `Series`, then genres. */
  categories?: readonly string[];
  /** Artwork the guide may show, by absolute URL. */
  iconUrl?: string | null;
  /** An episode's place in its series, by the numbers the owner sees. */
  episode?: {
    season: number;
    episode: number;
    /** The last episode a multi-episode file holds, when past `episode`. */
    lastEpisode?: number | null;
  } | null;
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
        ...programmeElements(programme),
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

/**
 * A programme's child elements in the order the XMLTV DTD fixes: title,
 * sub-title, desc, date, category, icon, episode-num, then previously-shown.
 * Absent facts emit nothing, so a client never sees an empty element. Every
 * programme is previously shown: kraziTV airs library content, and a client
 * treats a programme without the element as a premiere and badges it new.
 */
function programmeElements(programme: GuideProgramme): string[] {
  const lines = [`    <title>${escapeXml(programme.title)}</title>`];
  if (programme.subTitle)
    lines.push(`    <sub-title>${escapeXml(programme.subTitle)}</sub-title>`);
  if (programme.description)
    lines.push(`    <desc>${escapeXml(programme.description)}</desc>`);
  if (programme.date)
    lines.push(`    <date>${escapeXml(programme.date)}</date>`);
  for (const category of programme.categories ?? [])
    lines.push(`    <category>${escapeXml(category)}</category>`);
  if (programme.iconUrl)
    lines.push(`    <icon src="${escapeXml(programme.iconUrl)}" />`);
  lines.push(...episodeNumbers(programme.episode), "    <previously-shown />");
  return lines;
}

/**
 * An episode's numbers in both forms clients read: `xmltv_ns`, zero-based
 * and only for a numbered season since the specials season has no index
 * there, and `onscreen`, as a season folder names it, spanning a
 * multi-episode file's range.
 */
function episodeNumbers(episode: GuideProgramme["episode"]): string[] {
  if (!episode) return [];
  const lines = [];
  if (episode.season >= 1 && episode.episode >= 1)
    lines.push(
      `    <episode-num system="xmltv_ns">${episode.season - 1}.${episode.episode - 1}.</episode-num>`,
    );
  const pad = (value: number) => String(value).padStart(2, "0");
  const last =
    episode.lastEpisode != null && episode.lastEpisode > episode.episode
      ? `-E${pad(episode.lastEpisode)}`
      : "";
  lines.push(
    `    <episode-num system="onscreen">S${pad(episode.season)}E${pad(episode.episode)}${last}</episode-num>`,
  );
  return lines;
}
