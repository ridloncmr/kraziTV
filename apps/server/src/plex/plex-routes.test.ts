import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { createChannel, updateChannel } from "../testing/api-requests.js";
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

describe("GET /plex/xmltv.xml channels", () => {
  // Creates channels through the API so IDs are real UUIDs and none has a programming block.
  async function startGuideServer() {
    const { server } = await startTestServer();
    const create = async (payload: object) =>
      (await createChannel(server, payload)).json<{ id: string }>().id;
    return { server, create };
  }

  async function readGuide(server: FastifyInstance) {
    const response = await server.inject({
      method: "GET",
      url: "/plex/xmltv.xml",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/xml; charset=utf-8",
    );
    return response.body;
  }

  it("declares enabled channels by UUID, without a programming block, and omits disabled ones", async () => {
    const { server, create } = await startGuideServer();
    const on = await create({ number: "69", name: "Krazi Comedy" });
    const off = await create({ number: "70", name: "Dark", enabled: false });

    const guide = await readGuide(server);

    expect(on).toMatch(/^[0-9a-f-]{36}$/);
    expect(guide).toContain(
      `<channel id="${on}.krazitv">\n    <display-name>Krazi Comedy</display-name>\n    <display-name>69</display-name>`,
    );
    expect(guide).not.toContain(off);
    expect(guide).not.toContain("Dark");
  });

  it("keeps the channel ID when the channel is renumbered", async () => {
    const { server, create } = await startGuideServer();
    const id = await create({ number: "69", name: "Krazi Comedy" });

    expect((await updateChannel(server, id, { number: "12" })).statusCode).toBe(
      200,
    );
    const guide = await readGuide(server);

    expect(guide).toContain(`<channel id="${id}.krazitv">`);
    expect(guide).toContain("<display-name>12</display-name>");
    expect(guide).not.toContain("<display-name>69</display-name>");
  });

  it("escapes XML metacharacters in channel names", async () => {
    const { server, create } = await startGuideServer();
    await create({ number: "7", name: `Tom & Jerry's <Best> "Hits"` });

    expect(await readGuide(server)).toContain(
      "<display-name>Tom &amp; Jerry&apos;s &lt;Best&gt; &quot;Hits&quot;</display-name>",
    );
  });
});
