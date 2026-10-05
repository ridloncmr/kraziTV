import {
  formatDeviceXml,
  formatDiscovery,
  formatLineup,
  formatLineupStatus,
} from "@krazitv/plex";
import type { FastifyInstance } from "fastify";

import type { ChannelRepository } from "../channels/repository/channel-repository.js";
import { channelStreamPath } from "../channels/routes/channel-stream-routes.js";

const LINEUP_PATH = "/lineup.json";

/** Deployment values the Plex routes build URLs and tuner identity from, parsed once at startup. */
export type PlexSettings = {
  publicBaseUrl: string;
  deviceId: string;
  tunerCount: number;
};

/**
 * Registers the HDHomeRun-compatible routes Plex reads. They only format
 * what channels already hold; tuning happens at the provider-neutral stream
 * route the lineup links to.
 */
export function registerPlexRoutes(
  server: FastifyInstance,
  channels: ChannelRepository,
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
    const lineup = (await channels.list()).filter((channel) => channel.enabled);
    return formatLineup(
      lineup.map((channel) => ({
        number: channel.number,
        name: channel.name,
        streamUrl: `${publicBaseUrl}${channelStreamPath(channel.id)}`,
      })),
    );
  });

  server.get("/device.xml", async (_request, reply) =>
    reply
      .type("application/xml; charset=utf-8")
      .send(formatDeviceXml(deviceId)),
  );
}
