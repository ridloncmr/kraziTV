import { resourcePath } from "../http/api-client.js";

/** Selects a 24-hour observation window; the server alone generates its authoritative entries. */
export function scheduleWindowPath(
  channelId: string,
  start = Date.now(),
): string {
  const query = new URLSearchParams({
    start: new Date(start).toISOString(),
    end: new Date(start + 24 * 60 * 60 * 1000).toISOString(),
  });
  return `${resourcePath("channels", channelId)}/schedule?${query}`;
}
