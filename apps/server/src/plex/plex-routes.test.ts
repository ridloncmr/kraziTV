import { SCHEDULE_HORIZON_MS } from "@krazitv/krazi-brain";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import {
  createChannel,
  iso,
  send,
  updateChannel,
} from "../testing/api-requests.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { channelFixture } from "../testing/channel-fixtures.js";
import { holdWriteAuthority } from "../testing/hold-write-authority.js";
import {
  readOnlyScheduleState,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../testing/schedule-server.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
  startTestServer,
} from "../testing/test-environment.js";
import {
  readGuideProgrammes,
  xmltvTimestamp,
} from "../testing/xmltv-programmes.js";

afterEach(cleanUpTestEnvironment);

const BASE_URL = "http://plex-facing.lan:8080";
const HOUR = 3_600_000;

// Fetches the guide and checks it is served as XML, returning the document.
async function readGuideXml(server: FastifyInstance) {
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

  it("declares enabled channels by UUID, without a programming block, and omits disabled ones", async () => {
    const { server, create } = await startGuideServer();
    const on = await create({ number: "69", name: "Krazi Comedy" });
    const off = await create({ number: "70", name: "Dark", enabled: false });

    const guide = await readGuideXml(server);

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
    const guide = await readGuideXml(server);

    expect(guide).toContain(`<channel id="${id}.krazitv">`);
    expect(guide).toContain("<display-name>12</display-name>");
    expect(guide).not.toContain("<display-name>69</display-name>");
  });

  it("escapes XML metacharacters in channel names", async () => {
    const { server, create } = await startGuideServer();
    await create({ number: "7", name: `Tom & Jerry's <Best> "Hits"` });

    expect(await readGuideXml(server)).toContain(
      "<display-name>Tom &amp; Jerry&apos;s &lt;Best&gt; &quot;Hits&quot;</display-name>",
    );
  });
});

describe("GET /plex/xmltv.xml programmes", () => {
  const CHANNEL = `${channelFixture.id}.krazitv`;

  // Programmes the guide should list: entries overlapping [start, end) as XMLTV values.
  async function expectedProgrammes(
    db: Kysely<DatabaseSchema>,
    start: number,
    end: number,
  ) {
    return (await readScheduleEntries(db, channelFixture.id))
      .filter((entry) => entry.starts_at < end && entry.ends_at > start)
      .map((entry) => ({
        start: xmltvTimestamp(entry.starts_at),
        stop: xmltvTimestamp(entry.ends_at),
        channel: CHANNEL,
        title: entry.title,
      }));
  }

  it("lists the programme airing now through the 72-hour window and nothing that starts after it", async () => {
    const { server, db, clock } = await startScheduleScenarioServer();
    clock.advance(30 * 60_000);
    const now = clock.now();
    const end = now + SCHEDULE_HORIZON_MS;
    // Generate past the window so an entry starting after it exists.
    const generated = await send(
      server,
      "POST",
      `/channels/${channelFixture.id}/schedule/generate`,
      { through: iso(end + 8 * HOUR) },
    );
    expect(generated.status).toBe(200);

    const programmes = readGuideProgrammes(await readGuideXml(server));

    const expected = await expectedProgrammes(db, now, end);
    expect(programmes).toEqual(expected);
    // The airing entry started before the request; a later one is left out.
    expect(programmes[0]?.start).toBe(
      xmltvTimestamp(FIXTURE_TIME + 22 * 60_000),
    );
    const entries = await readScheduleEntries(db, channelFixture.id);
    expect(entries.some((entry) => entry.starts_at >= end)).toBe(true);
  });

  it("extends coverage when the clock has passed it and lists the new entries", async () => {
    const { server, db, clock } = await startScheduleScenarioServer();
    clock.advance(SCHEDULE_HORIZON_MS + 28 * HOUR);
    const now = clock.now();

    const programmes = readGuideProgrammes(await readGuideXml(server));

    expect(programmes[0]?.start).toBe(xmltvTimestamp(now));
    expect(programmes).toEqual(
      await expectedProgrammes(db, now, now + SCHEDULE_HORIZON_MS),
    );
    expect(
      (await readOnlyScheduleState(db)).last_generated_through,
    ).toBeGreaterThanOrEqual(now + SCHEDULE_HORIZON_MS);
  });

  it("escapes XML metacharacters in programme titles", async () => {
    const { server, db } = await startScheduleScenarioServer();
    await db
      .updateTable("schedule_entries")
      .set({ title: `Tom & Jerry's <Best> "Hits"` })
      .execute();

    expect(await readGuideXml(server)).toContain(
      "<title>Tom &amp; Jerry&apos;s &lt;Best&gt; &quot;Hits&quot;</title>",
    );
  });

  it("answers the shared retryable 503 while another connection holds write authority", async () => {
    const { server, dataDirectory } = await startScheduleScenarioServer();
    const other = await openTestDatabase(dataDirectory);
    const holder = await holdWriteAuthority(other.db);
    try {
      const { status, body } = await send(server, "GET", "/plex/xmltv.xml");

      expect(status).toBe(503);
      expect(body.error).toMatchObject({
        code: "schedule_busy",
        retryable: true,
      });
    } finally {
      await holder.release();
    }
  });
});
