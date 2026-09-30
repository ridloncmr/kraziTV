import type { ChannelStreamManagerContract } from "@krazitv/signal";
import Fastify, { type FastifyServerOptions } from "fastify";

const DEVICE_ID = "1234ABCD";

export type BuildSpikeServerOptions = FastifyServerOptions & {
  manager: ChannelStreamManagerContract;
  publicBaseUrl: string;
};

/** Builds the disposable tuner surface around the retained signal manager. */
export function buildSpikeServer(options: BuildSpikeServerOptions) {
  const { manager, publicBaseUrl, ...fastifyOptions } = options;
  const baseUrl = publicBaseUrl.replace(/\/+$/, "");
  const server = Fastify(fastifyOptions);

  server.get("/discover.json", async () => ({
    FriendlyName: "kraziTV Plex Spike",
    Manufacturer: "kraziTV",
    ModelNumber: "KRAZI-SPIKE-1",
    FirmwareName: "kraziTV",
    FirmwareVersion: "0.0.0-spike",
    DeviceID: DEVICE_ID,
    DeviceAuth: "test1234",
    BaseURL: baseUrl,
    LineupURL: `${baseUrl}/lineup.json`,
    TunerCount: 1,
  }));

  server.get("/lineup_status.json", async () => ({
    ScanInProgress: 0,
    ScanPossible: 1,
    Source: "Antenna",
    SourceList: ["Antenna"],
  }));

  server.get("/lineup.json", async () => [
    {
      GuideNumber: "69",
      GuideName: "Krazi Comedy",
      URL: `${baseUrl}/channels/69/stream`,
    },
  ]);

  server.get("/device.xml", async (_request, reply) => {
    reply.type("application/xml; charset=utf-8");
    return `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>kraziTV Plex Spike</friendlyName>
    <manufacturer>kraziTV</manufacturer>
    <modelName>kraziTV Plex Spike</modelName>
    <modelNumber>KRAZI-SPIKE-1</modelNumber>
    <serialNumber>${DEVICE_ID}</serialNumber>
    <UDN>uuid:${DEVICE_ID}</UDN>
  </device>
</root>`;
  });

  server.get("/channels/69/stream", async (request, reply) => {
    const requestedAt = Date.now();
    const controller = new AbortController();
    let subscription:
      | Awaited<ReturnType<ChannelStreamManagerContract["subscribe"]>>
      | undefined;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      controller.abort();
      subscription?.close();
      request.log.info(
        {
          channelId: "69",
          requestedAt,
          disconnectedAt: Date.now(),
        },
        "Plex spike viewer disconnected",
      );
    };
    request.raw.once("aborted", release);
    reply.raw.once("close", release);

    try {
      subscription = await manager.subscribe("69", {
        signal: controller.signal,
      });
      const subscribedAt = Date.now();
      request.log.info(
        {
          channelId: "69",
          requestedAt,
          subscribedAt,
          startupWaitMs: subscribedAt - requestedAt,
        },
        "Plex spike viewer subscribed",
      );
      reply.type("video/mp2t");
      return reply.send(subscription.stream);
    } catch (error) {
      release();
      throw error;
    }
  });

  server.addHook("preClose", async () => manager.shutdown());
  return server;
}
