import { afterEach, describe, expect, it } from "vitest";

import { channelFixture } from "../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const BASE_URL = "http://plex-facing.lan:8080";

describe("GET /lineup.json", () => {
  it("lists enabled channels in channel-number order with stream URLs on the configured base", async () => {
    const { server } = await startTestServer({
      plex: { publicBaseUrl: BASE_URL },
      // Inserted 10 first, and text order also puts "10" before "2".
      seed: async (db) => {
        await db
          .insertInto("channels")
          .values([
            { ...channelFixture, id: "ten", number: "10", name: "Ten" },
            { ...channelFixture, id: "two", number: "2", name: "Two" },
            {
              ...channelFixture,
              id: "off",
              number: "5",
              name: "Off",
              enabled: 0,
            },
          ])
          .execute();
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/lineup.json",
      headers: { host: "attacker.example:9999" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual([
      {
        GuideNumber: "2",
        GuideName: "Two",
        URL: `${BASE_URL}/channels/two/stream`,
      },
      {
        GuideNumber: "10",
        GuideName: "Ten",
        URL: `${BASE_URL}/channels/ten/stream`,
      },
    ]);
  });
});

describe("tuner device endpoints", () => {
  const PLEX = {
    publicBaseUrl: BASE_URL,
    deviceId: "0BADF00D",
    tunerCount: 5,
  };

  it("serves discovery from the configured device identity and base", async () => {
    const { server } = await startTestServer({ plex: PLEX });

    const response = await server.inject({
      method: "GET",
      url: "/discover.json",
      headers: { host: "attacker.example:9999" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      DeviceID: "0BADF00D",
      TunerCount: 5,
      BaseURL: BASE_URL,
      LineupURL: `${BASE_URL}/lineup.json`,
    });
  });

  it("serves an idle lineup status", async () => {
    const { server } = await startTestServer({ plex: PLEX });

    const response = await server.inject({
      method: "GET",
      url: "/lineup_status.json",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ScanInProgress: 0 });
  });

  it("serves device.xml as XML carrying the device ID", async () => {
    const { server } = await startTestServer({ plex: PLEX });

    const response = await server.inject({ method: "GET", url: "/device.xml" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/xml; charset=utf-8",
    );
    expect(response.body).toContain("<serialNumber>0BADF00D</serialNumber>");
    expect(response.body).toContain("<UDN>uuid:0BADF00D</UDN>");
  });
});
