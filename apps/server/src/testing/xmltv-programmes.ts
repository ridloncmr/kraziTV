// Reads XMLTV guide output for route and acceptance tests only; production code must never import this module.

/** One `<programme>` as a test compares it with schedule entries. */
export interface GuideProgramme {
  start: string;
  stop: string;
  channel: string;
  title: string;
}

const PROGRAMME =
  /<programme start="([^"]*)" stop="([^"]*)" channel="([^"]*)">\s*<title>([^<]*)<\/title>/g;

/** Extracts every programme in document order, leaving values exactly as emitted. */
export function readGuideProgrammes(xml: string): GuideProgramme[] {
  return [...xml.matchAll(PROGRAMME)].map(
    ([, start = "", stop = "", channel = "", title = ""]) => ({
      start,
      stop,
      channel,
      title,
    }),
  );
}

/**
 * Formats an epoch millisecond the way XMLTV timestamps are expected to look.
 * Built from UTC date parts, unlike the production formatter, so a test
 * comparing the two checks the formatter instead of repeating it.
 */
export function xmltvTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  const parts = [
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ].map((part) => String(part).padStart(2, "0"));
  return `${date.getUTCFullYear()}${parts.join("")} +0000`;
}
