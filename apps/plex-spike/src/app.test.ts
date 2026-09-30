import { PassThrough } from "node:stream";

import type {
  ChannelStreamManagerContract,
  ChannelSubscription,
} from "@krazitv/signal";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSpikeServer } from "./app.js";

const servers: ReturnType<typeof buildSpikeServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const createManager = () => {
  const streams: PassThrough[] = [];
  const subscriptions: ChannelSubscription[] = [];
  const manager: ChannelStreamManagerContract = {
    subscribe: vi.fn(async () => {
      const stream = new PassThrough();
      const subscription = { stream, close: vi.fn(() => stream.destroy()) };
      streams.push(stream);
      subscriptions.push(subscription);
      return subscription;
    }),
    stopChannel: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => {
      for (const stream of streams) stream.end();
    }),
  };
  return { manager, streams, subscriptions };
};

describe("buildSpikeServer", () => {
  it("serves fixed HDHomeRun discovery metadata from the configured public URL", async () => {
    const { manager } = createManager();
    const server = buildSpikeServer({
      logger: false,
      manager,
      publicBaseUrl: "http://10.0.0.25:3100/",
    });
    servers.push(server);

    const discovery = await server.inject("/discover.json");
    const status = await server.inject("/lineup_status.json");

    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toEqual({
      FriendlyName: "kraziTV Plex Spike",
      Manufacturer: "kraziTV",
      ModelNumber: "KRAZI-SPIKE-1",
      FirmwareName: "kraziTV",
      FirmwareVersion: "0.0.0-spike",
      DeviceID: "1234ABCD",
      DeviceAuth: "test1234",
      BaseURL: "http://10.0.0.25:3100",
      LineupURL: "http://10.0.0.25:3100/lineup.json",
      TunerCount: 1,
    });
    expect(status.json()).toEqual({
      ScanInProgress: 0,
      ScanPossible: 1,
      Source: "Antenna",
      SourceList: ["Antenna"],
    });
  });

  it("lists only the fixed Channel 69 stream at the configured public URL", async () => {
    const { manager } = createManager();
    const server = buildSpikeServer({
      logger: false,
      manager,
      publicBaseUrl: "http://plex-spike.local:3000/",
    });
    servers.push(server);

    const response = await server.inject("/lineup.json");

    expect(response.json()).toEqual([
      {
        GuideNumber: "69",
        GuideName: "Krazi Comedy",
        URL: "http://plex-spike.local:3000/channels/69/stream",
      },
    ]);
  });

  it("serves stable XML device metadata", async () => {
    const { manager } = createManager();
    const server = buildSpikeServer({
      logger: false,
      manager,
      publicBaseUrl: "http://127.0.0.1:3000",
    });
    servers.push(server);

    const response = await server.inject("/device.xml");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/xml");
    expect(response.body).toContain(
      "<friendlyName>kraziTV Plex Spike</friendlyName>",
    );
    expect(response.body).toContain("<serialNumber>1234ABCD</serialNumber>");
    expect(response.body).toContain("<UDN>uuid:1234ABCD</UDN>");
  });

  it("subscribes the request to the shared Channel 69 signal and releases it", async () => {
    const { manager, streams, subscriptions } = createManager();
    const server = buildSpikeServer({
      logger: false,
      manager,
      publicBaseUrl: "http://127.0.0.1:3000",
    });
    servers.push(server);

    const pending = server.inject("/channels/69/stream");
    await vi.waitFor(() => expect(manager.subscribe).toHaveBeenCalledOnce());
    streams[0]?.end(Buffer.from("mpeg-ts"));
    const response = await pending;

    expect(manager.subscribe).toHaveBeenCalledWith("69", {
      signal: expect.any(AbortSignal),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("video/mp2t");
    expect(response.rawPayload.toString()).toBe("mpeg-ts");
    expect(subscriptions[0]?.close).toHaveBeenCalledOnce();
  });

  it("shuts down the injected manager when the spike server closes", async () => {
    const { manager } = createManager();
    const server = buildSpikeServer({
      logger: false,
      manager,
      publicBaseUrl: "http://127.0.0.1:3000",
    });

    await server.close();

    expect(manager.shutdown).toHaveBeenCalledOnce();
  });

  it("shuts down the manager before waiting for an active stream to close", async () => {
    const { manager } = createManager();
    const server = buildSpikeServer({
      logger: false,
      manager,
      publicBaseUrl: "http://127.0.0.1:3000",
    });
    const streaming = server.inject("/channels/69/stream");
    await vi.waitFor(() => expect(manager.subscribe).toHaveBeenCalledOnce());

    await server.close();
    await streaming;

    expect(manager.shutdown).toHaveBeenCalledOnce();
  });
});
