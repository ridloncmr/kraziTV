import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import {
  formatDeviceXml,
  formatDiscovery,
  formatLineup,
  formatLineupStatus,
  formatXmltv,
} from "@krazitv/plex";
import type { FastifyInstance } from "fastify";

import type { ChannelRepository } from "../channels/repository/channel-repository.js";
import { channelStreamPath } from "../channels/routes/channel-stream-routes.js";
import type { MediaItemRepository } from "../media-items/media-item-repository.js";
import type { ScheduleService } from "../schedules/schedule-service.js";
import { guideProgramme } from "./guide-programme.js";

const LINEUP_PATH = "/lineup.json";
const XML_CONTENT_TYPE = "application/xml; charset=utf-8";

/** Deployment values the Plex routes build URLs and tuner identity from, parsed once at startup. */
export type PlexSettings = {
  publicBaseUrl: string;
  deviceId: string;
  tunerCount: number;
};

/**
 * Registers the HDHomeRun-compatible and XMLTV routes Plex reads. They only
 * format what channels, schedules, and the catalog's content metadata
 * already hold; tuning happens at the provider-neutral stream route the
 * lineup links to.
 */
export function registerPlexRoutes(
  server: FastifyInstance,
  channels: ChannelRepository,
  schedules: ScheduleService,
  mediaItems: MediaItemRepository,
  settings: PlexSettings,
): void {
  const { publicBaseUrl, deviceId, tunerCount } = settings;

  // Administration reads configured public URLs without reproducing provider URL policy.
  server.get("/plex/setup", async () => ({
    tunerBaseUrl: publicBaseUrl,
    xmltvUrl: `${publicBaseUrl}/plex/xmltv.xml`,
  }));

  server.get("/discover.json", async () =>
    formatDiscovery({
      deviceId,
      tunerCount,
      baseUrl: publicBaseUrl,
      lineupUrl: `${publicBaseUrl}${LINEUP_PATH}`,
    }),
  );

  server.get("/lineup_status.json", async () => formatLineupStatus());

  server.get(LINEUP_PATH, async () => {
    const lineup = await listEnabledChannels(channels);
    return formatLineup(
      lineup.map((channel) => ({
        number: channel.number,
        name: channel.name,
        streamUrl: `${publicBaseUrl}${channelStreamPath(channel.id)}`,
      })),
    );
  });

  server.get("/device.xml", async (_request, reply) =>
    reply.type(XML_CONTENT_TYPE).send(formatDeviceXml(deviceId)),
  );

  // A busy schedule writer propagates to the shared schedule_busy 503 handler.
  server.get("/plex/xmltv.xml", async (request, reply) => {
    const start = schedules.now();
    const end = start + SCHEDULE_HORIZON_MS;
    const guide = [];
    // One channel at a time, so coverage writes never queue for write authority.
    for (const channel of await listEnabledChannels(channels)) {
      // Any outcome still reads the window: an unschedulable channel keeps
      // listing entries generated before it became unschedulable.
      await schedules.ensureCoverage(channel.id, request.log);
      const { entries } = await schedules.readWindow(channel.id, start, end);
      // Content facts are read after the window, outside its snapshot: a
      // title or description a beat newer than the entries is harmless.
      const items = await mediaItems.listByIds(
        entries.map((entry) => entry.mediaItemId),
      );
      guide.push({
        id: channel.id,
        number: channel.number,
        name: channel.name,
        programmes: entries.map((entry) =>
          guideProgramme(entry, items.get(entry.mediaItemId)?.metadata),
        ),
      });
    }
    return reply.type(XML_CONTENT_TYPE).send(formatXmltv(guide));
  });
}

/** Lists the channels Plex may see, in lineup order; disabled channels never reach Plex. */
async function listEnabledChannels(channels: ChannelRepository) {
  return (await channels.list()).filter((channel) => channel.enabled);
}
