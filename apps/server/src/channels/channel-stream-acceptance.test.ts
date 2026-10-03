import {
  SystemRuntime,
  type ChannelStreamManagerContract,
} from "@krazitv/signal";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { send } from "../testing/api-requests.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import {
  seedScheduleScenario,
  type ScheduleScenarioOptions,
} from "../testing/schedule-fixtures.js";
import {
  JOINABLE_OUTPUT,
  ScriptedSignalPackager,
  transportPacket,
} from "../testing/scripted-signal-packager.js";
import { settleWithin } from "../testing/settle-within.js";
import {
  listenOnLoopback,
  openStreamRequest,
  readChunk,
  responseFinished,
} from "../testing/stream-client.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../testing/test-environment.js";
import { PlayoutService } from "../playout/playout-service.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { composeChannelStreamManager } from "./runtime/channel-stream-composition.js";

const MINUTE = 60_000;
// Eight minutes into the second of three chronological episodes.
const MID_SECOND = FIXTURE_TIME + 30 * MINUTE;
const CHANNEL_ID = "channel-fixture-001";
const STREAM_URL = `/channels/${CHANNEL_ID}/stream`;
const EPISODES: ScheduleScenarioOptions = {
  items: [22, 23, 24].map((minutes) => ({ durationMs: minutes * MINUTE })),
  source: "chronological",
};

const managers: ChannelStreamManagerContract[] = [];

// Managers settle before the database closes, because a worker reads playout.
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  await cleanUpTestEnvironment();
});

// Composes the real manager over the scenario with a scripted packager in
// place of FFmpeg. The schedule anchors at FIXTURE_TIME on startup; the clock
// then moves eight minutes into the second episode.
async function startStreamingServer(
  scenario: Partial<ScheduleScenarioOptions> = {},
  options: { startupTimeoutMs?: number } = {},
) {
  const clock = manualClock(FIXTURE_TIME);
  const packager = new ScriptedSignalPackager();
  const timers = new SystemRuntime();
  const { server } = await startTestServer({
    seed: async (db) => {
      await seedScheduleScenario(db, { ...EPISODES, ...scenario });
    },
    overrides: (db, defaults) => {
      const schedules = new ScheduleService(db, {
        now: clock.now,
        createId: sequentialIds("entry"),
      });
      const playout = new PlayoutService(db, schedules);
      const manager = composeChannelStreamManager({
        db,
        playout,
        channels: defaults.channels,
        log: pino({ level: "silent" }),
        packager,
        runtime: {
          now: clock.now,
          setTimeout: (callback, delayMs) =>
            timers.setTimeout(callback, delayMs),
        },
        ...options,
      });
      managers.push(manager);
      return { schedules, playout, channelStreams: manager };
    },
  });
  await server.ready();
  clock.set(MID_SECOND);
  return { server, packager };
}

describe("channel stream acceptance", () => {
  it("joins two viewers to one worker at the current item's offset", async () => {
    const { server, packager } = await startStreamingServer();
    const baseUrl = await listenOnLoopback(server);

    const first = await openStreamRequest(`${baseUrl}${STREAM_URL}`);
    const second = await openStreamRequest(`${baseUrl}${STREAM_URL}`);

    expect(first.response.statusCode).toBe(200);
    expect(first.response.headers["content-type"]).toBe("video/MP2T");
    expect(second.response.statusCode).toBe(200);
    expect(packager.sessions).toHaveLength(1);
    expect(packager.sessions[0]?.item).toMatchObject({
      channelId: CHANNEL_ID,
      mediaItemId: "item-002",
      mediaOffsetMs: 8 * MINUTE,
    });
    expect(await readChunk(first.response)).toEqual(JOINABLE_OUTPUT);
    expect(await readChunk(second.response)).toEqual(JOINABLE_OUTPUT);
  });

  it("keeps the other viewer live when one disconnects", async () => {
    const { server, packager } = await startStreamingServer();
    const baseUrl = await listenOnLoopback(server);
    const leaving = await openStreamRequest(`${baseUrl}${STREAM_URL}`);
    const staying = await openStreamRequest(`${baseUrl}${STREAM_URL}`);
    await readChunk(leaving.response);
    await readChunk(staying.response);

    leaving.request.destroy();
    await vi.waitFor(() => expect(leaving.response.closed).toBe(true));
    const later = transportPacket(256);
    packager.sessions[0]?.output.write(later);

    expect(await readChunk(staying.response)).toEqual(later);
    expect(packager.sessions[0]?.stopped).toBe(false);
  });

  it("answers 404 for an unknown channel without starting a worker", async () => {
    const { server, packager } = await startStreamingServer();

    const { status, body } = await send(server, "GET", "/channels/nope/stream");

    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: "channel_not_found" } });
    expect(packager.sessions).toHaveLength(0);
  });

  it("answers 409 for a disabled channel without starting a worker", async () => {
    const { server, packager } = await startStreamingServer({ enabled: false });

    const { status, body } = await send(server, "GET", STREAM_URL);

    expect(status).toBe(409);
    expect(body).toMatchObject({ error: { code: "channel_disabled" } });
    expect(packager.sessions).toHaveLength(0);
  });

  it("answers 409 when nothing airs on the channel", async () => {
    const { server, packager } = await startStreamingServer({ source: null });

    const { status, body } = await send(server, "GET", STREAM_URL);

    expect(status).toBe(409);
    expect(body).toMatchObject({ error: { code: "no_current_playout" } });
    expect(packager.sessions).toHaveLength(0);
  });

  it("answers a retryable 503 and stops the session when readiness times out", async () => {
    const { server, packager } = await startStreamingServer(
      {},
      { startupTimeoutMs: 50 },
    );
    packager.readiness = "never";

    const { status, body } = await send(server, "GET", STREAM_URL);

    expect(status).toBe(503);
    expect(body).toMatchObject({
      error: { code: "stream_startup_timeout", retryable: true },
    });
    await vi.waitFor(() => expect(packager.sessions[0]?.stopped).toBe(true));
  });

  it("ends live streams and stops the session when the server closes", async () => {
    const { server, packager } = await startStreamingServer();
    const baseUrl = await listenOnLoopback(server);
    const viewer = await openStreamRequest(`${baseUrl}${STREAM_URL}`);
    await readChunk(viewer.response);

    await settleWithin(server.close(), 2_000, "server close");

    await responseFinished(viewer.response);
    expect(packager.sessions[0]?.stopped).toBe(true);
  });
});
