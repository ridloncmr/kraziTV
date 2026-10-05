import { formatLineup } from "@krazitv/plex";
import type { FastifyInstance } from "fastify";

import type { ChannelRepository } from "../channels/repository/channel-repository.js";
import { channelStreamPath } from "../channels/routes/channel-stream-routes.js";

/** Deployment values the Plex routes build absolute URLs from, parsed once at startup. */
export type PlexSettings = {
  publicBaseUrl: string;
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
  server.get("/lineup.json", async () => {
    const lineup = (await channels.list()).filter((channel) => channel.enabled);
    return formatLineup(
      lineup.map((channel) => ({
        number: channel.number,
        name: channel.name,
        streamUrl: `${settings.publicBaseUrl}${channelStreamPath(channel.id)}`,
      })),
    );
  });
}
