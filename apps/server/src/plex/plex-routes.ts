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
import type { ScheduleService } from "../schedules/schedule-service.js";

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
 * format what channels and schedules already hold; tuning happens at the
 * provider-neutral stream route the lineup links to.
 */
export function registerPlexRoutes(
  server: FastifyInstance,
  channels: ChannelRepository,
  schedules: ScheduleService,
  settings: PlexSettings,
): void {
  const { publicBaseUrl, deviceId, tunerCount } = settings;

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
      guide.push({
        id: channel.id,
        number: channel.number,
        name: channel.name,
        programmes: entries.map((entry) => ({
          startsAt: entry.startsAt,
          endsAt: entry.endsAt,
          title: entry.title,
        })),
      });
    }
    return reply.type(XML_CONTENT_TYPE).send(formatXmltv(guide));
  });
}

/** Lists the channels Plex may see, in lineup order; disabled channels never reach Plex. */
async function listEnabledChannels(channels: ChannelRepository) {
  return (await channels.list()).filter((channel) => channel.enabled);
}
