import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import {
  formatDeviceXml,
  formatDiscovery,
  formatLineup,
  formatLineupStatus,
  formatXmltv,
} from "@krazitv/plex";
import type { FastifyInstance } from "fastify";

import { isLoopbackHost } from "../config/network.js";
import type { ChannelRepository } from "../channels/repository/channel-repository.js";
import { channelStreamPath } from "../channels/routes/channel-stream-routes.js";
import type { MediaItemRepository } from "../media-items/media-item-repository.js";
import { guidePrograms } from "../schedules/guide/guide-program.js";
import type { SchedulePreview } from "../schedules/preview/schedule-preview.js";
import type { ScheduleService } from "../schedules/schedule-service.js";
import { offAirProgramme, xmltvProgramme } from "./xmltv-programme.js";

const LINEUP_PATH = "/lineup.json";
const XML_CONTENT_TYPE = "application/xml; charset=utf-8";

/** Deployment values the Plex routes build URLs and tuner identity from, parsed once at startup. */
export type PlexSettings = {
  publicBaseUrl: string;
  deviceId: string;
  tunerCount: number;
  /** The address the server listens on, the HOST setting. */
  listenHost: string;
  /** This computer's network address, which Plex Setup suggests as the public base URL. */
  networkBaseUrl: string | null;
};

/**
 * Registers the HDHomeRun-compatible and XMLTV routes Plex reads. They only
 * format what channels, schedules, planned filler, and the catalog's content
 * metadata already hold; tuning happens at the provider-neutral stream route the
 * lineup links to.
 */
export function registerPlexRoutes(
  server: FastifyInstance,
  channels: ChannelRepository,
  schedules: ScheduleService,
  schedulePreview: SchedulePreview,
  mediaItems: MediaItemRepository,
  settings: PlexSettings,
): void {
  const { publicBaseUrl, deviceId, tunerCount } = settings;
  // The settings that keep Plex on another device out, because they name
  // this computer only. Plex on this computer still reaches it.
  const localOnlySettings = [
    ...(isLoopbackHost(new URL(publicBaseUrl).hostname)
      ? ["PUBLIC_BASE_URL"]
      : []),
    ...(isLoopbackHost(settings.listenHost) ? ["HOST"] : []),
  ];

  // Administration reads configured public URLs without reproducing provider URL policy.
  server.get("/plex/setup", async () => ({
    tunerBaseUrl: publicBaseUrl,
    xmltvUrl: `${publicBaseUrl}/plex/xmltv.xml`,
    localOnlySettings,
    suggestedPublicBaseUrl: settings.networkBaseUrl,
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
    const timeZone = schedules.programmingTimezone();
    const start = schedules.now();
    const end = start + SCHEDULE_HORIZON_MS;
    const guide = [];
    // One channel at a time, so coverage writes never queue for write authority.
    for (const channel of await listEnabledChannels(channels)) {
      // Any outcome still reads the window: an unschedulable channel keeps
      // listing entries generated before it became unschedulable.
      await schedules.ensureCoverage(channel.id, request.log);
      const { entries, fillerIntervals } = await schedulePreview.readWindow(
        channel.id,
        start,
        end,
      );
      // Planned filler lists as Off air among the programs (ADR 0022).
      const programmes = [
        ...(await guidePrograms(mediaItems, entries)).map(
          ({ entry, program }) => xmltvProgramme(entry, program),
        ),
        ...fillerIntervals.map((interval) =>
          offAirProgramme(interval, timeZone),
        ),
      ].sort((a, b) => a.startsAt - b.startsAt);
      guide.push({
        id: channel.id,
        number: channel.number,
        name: channel.name,
        programmes,
      });
    }
    return reply.type(XML_CONTENT_TYPE).send(formatXmltv(guide));
  });
}

/** Lists the channels Plex may see, in lineup order; disabled channels never reach Plex. */
async function listEnabledChannels(channels: ChannelRepository) {
  return (await channels.list()).filter((channel) => channel.enabled);
}
