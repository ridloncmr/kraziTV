import { afterEach, describe, expect, it } from "vitest";

import { ScheduleService } from "../schedules/schedule-service.js";
import { createChannel, send } from "../testing/api-requests.js";
import {
  collectionFixture,
  collectionItemFixture,
  FIXTURE_TIME,
  itemFixture,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import { ControlledChannelStreams } from "../testing/controlled-channel-streams.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import { readScheduleEntries } from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../testing/test-environment.js";
import {
  readGuideProgrammes,
  xmltvTimestamp,
} from "../testing/xmltv-programmes.js";

afterEach(cleanUpTestEnvironment);

const PUBLIC_BASE_URL = "http://plex-facing.test:8080";
const DEVICE_ID = "0BADF00D";

describe("Plex adapter acceptance", () => {
  it("maps enabled channels and schedules to Plex while delegating its stream URL", async () => {
    const clock = manualClock(FIXTURE_TIME);
    const streams = new ControlledChannelStreams();
    const { server, db } = await startTestServer({
      plex: { publicBaseUrl: PUBLIC_BASE_URL, deviceId: DEVICE_ID },
      seed: async (db) => {
        await db.insertInto("media_roots").values(rootFixture).execute();
        await db.insertInto("media_items").values(itemFixture).execute();
        await db
          .insertInto("media_collections")
          .values(collectionFixture)
          .execute();
        await db
          .insertInto("media_collection_items")
          .values(collectionItemFixture)
          .execute();
      },
      overrides: (db) => ({
        schedules: new ScheduleService(db, {
          now: clock.now,
          createId: sequentialIds("plex-entry"),
        }),
        channelStreams: streams,
      }),
    });
    await server.ready();

    const enabled = (
      await createChannel(server, { number: "69", name: "Krazi Comedy" })
    ).json<{ id: string }>();
    const disabled = (
      await createChannel(server, {
        number: "70",
        name: "Dark Channel",
        enabled: false,
      })
    ).json<{ id: string }>();
    const block = await send(
      server,
      "POST",
      `/channels/${enabled.id}/programming-blocks`,
      {
        source: {
          kind: "collection",
          mediaCollectionId: collectionFixture.id,
          playbackMode: "chronological",
        },
      },
    );
    expect(block.status).toBe(201);

    const discovery = await server.inject("/discover.json");
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      DeviceID: DEVICE_ID,
      BaseURL: PUBLIC_BASE_URL,
      LineupURL: `${PUBLIC_BASE_URL}/lineup.json`,
    });
    const status = await server.inject("/lineup_status.json");
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ ScanInProgress: 0 });
    const device = await server.inject("/device.xml");
    expect(device.statusCode).toBe(200);
    expect(device.body).toContain(`<serialNumber>${DEVICE_ID}</serialNumber>`);

    const lineupResponse = await server.inject("/lineup.json");
    const lineup =
      lineupResponse.json<
        Array<{ GuideNumber: string; GuideName: string; URL: string }>
      >();
    expect(lineup).toStrictEqual([
      {
        GuideNumber: "69",
        GuideName: "Krazi Comedy",
        URL: `${PUBLIC_BASE_URL}/channels/${enabled.id}/stream`,
      },
    ]);

    const guideResponse = await server.inject("/plex/xmltv.xml");
    const guide = guideResponse.body;
    expect(guide).toContain(`<channel id="${enabled.id}.krazitv">`);
    expect(guide).not.toContain(disabled.id);
    expect(guide).not.toContain("Dark Channel");
    expect(readGuideProgrammes(guide)).toEqual(
      (await readScheduleEntries(db, enabled.id)).map((entry) => ({
        start: xmltvTimestamp(entry.starts_at),
        stop: xmltvTimestamp(entry.ends_at),
        channel: `${enabled.id}.krazitv`,
        title: entry.title,
      })),
    );

    const streamResponse = server.inject(new URL(lineup[0].URL).pathname);
    const subscription = await streams.nextSubscribe();
    subscription.open().stream.end(Buffer.from("mpeg-ts"));

    expect(subscription.channelId).toBe(enabled.id);
    await expect(streamResponse).resolves.toMatchObject({
      statusCode: 200,
      body: "mpeg-ts",
    });
  });
});
