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
      publicBaseUrl: BASE_URL,
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
