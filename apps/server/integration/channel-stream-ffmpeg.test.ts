// Spec 0006 end to end: persisted schedule, playout, transition coordinator,
// stream route, and real FFmpeg, on the wall clock. Run with `test:ffmpeg`.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFfmpegSignalPackager,
  type ChannelStreamManagerContract,
} from "@krazitv/signal";
import { pino } from "pino";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { composeChannelStreamManager } from "../src/channels/runtime/channel-stream-composition.js";
import { toSignalLogger } from "../src/channels/runtime/signal-log.js";
import { PlayoutService } from "../src/playout/playout-service.js";
import { ScheduleService } from "../src/schedules/schedule-service.js";
import { send } from "../src/testing/api-requests.js";
import { programmingBlockFixture } from "../src/testing/channel-fixtures.js";
import {
  decodedVideoMs,
  ffmpegPath,
  generateMediaFile,
  runningFfmpegProcesses,
} from "../src/testing/real-ffmpeg.js";
import { RecordingSignalPackager } from "../src/testing/recording-signal-packager.js";
import { seedScheduleScenario } from "../src/testing/schedule-fixtures.js";
import { settleWithin } from "../src/testing/settle-within.js";
import {
  listenOnLoopback,
  openStreamRequest,
  responseFinished,
} from "../src/testing/stream-client.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../src/testing/test-environment.js";
import { TrackedRuntime } from "../src/testing/tracked-runtime.js";

const MEDIA_DURATION_MS = 6_000;
// The last item airs for an hour on its six-second file, behind a black tail.
// Uniform six-second airtimes would materialize 43,200 entries over the
// horizon, and regenerating them holds write authority long enough under load
// to push a boundary past the worker's recovery deadline.
const LAST_AIRTIME_MS = 60 * 60_000;
const CHANNEL_ID = "channel-fixture-001";
const STREAM_URL = `/channels/${CHANNEL_ID}/stream`;
// Spec 0006's ceiling on initial tune drift at first usable output.
const DRIFT_CEILING_MS = 2_000;
const TEST_TIMEOUT_MS = 60_000;

let fixtureDirectory: string;
const mediaPaths: string[] = [];
const managers: ChannelStreamManagerContract[] = [];

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "krazitv-stream-e2e-"));
  for (const name of ["first", "second", "third"]) {
    mediaPaths.push(
      generateMediaFile(fixtureDirectory, name, MEDIA_DURATION_MS),
    );
  }
}, TEST_TIMEOUT_MS);

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  await cleanUpTestEnvironment();
  // A child that outlives its channel is a leak, whatever the test checked.
  expect(runningFfmpegProcesses(fixtureDirectory)).toEqual([]);
});

afterAll(async () => {
  if (fixtureDirectory !== undefined) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

/**
 * Boots the production composition over three real media files programmed
 * chronologically, so the schedule anchors at server startup on the wall
 * clock. Returns the first entries so tests can time tunes to boundaries.
 */
async function startRealChannel() {
  const runtime = new TrackedRuntime();
  const silent = pino({ level: "silent" });
  const packager = new RecordingSignalPackager(
    createFfmpegSignalPackager({
      logger: toSignalLogger(silent),
      timers: runtime,
      ffmpegPath,
    }),
  );
  const { server, db } = await startTestServer({
    seed: async (db) => {
      await seedScheduleScenario(db, {
        items: mediaPaths.map((path, index) => ({
          durationMs:
            index === mediaPaths.length - 1
              ? LAST_AIRTIME_MS
              : MEDIA_DURATION_MS,
          path,
        })),
        source: "chronological",
      });
    },
    overrides: (db, defaults) => {
      const schedules = new ScheduleService(db);
      const playout = new PlayoutService(db, schedules);
      const manager = composeChannelStreamManager({
        db,
        playout,
        channels: defaults.channels,
        log: silent,
        packager,
        runtime,
      });
      managers.push(manager);
      return {
        schedules,
        playout,
        channelStreams: manager,
        channelRuntime: manager,
      };
    },
  });
  const baseUrl = await listenOnLoopback(server);
  const entries = await db
    .selectFrom("schedule_entries")
    .select(["id", "media_item_id", "starts_at", "ends_at"])
    .where("channel_id", "=", CHANNEL_ID)
    .orderBy("sequence_number")
    .limit(4)
    .execute();
  // Tests time tunes from the first entry; a setup that overran it tests nothing.
  expect(Date.now(), "setup overran the first entry").toBeLessThan(
    (entries[0]?.starts_at ?? 0) + 1_000,
  );
  return { server, db, baseUrl, packager, runtime, entries };
}

/** Tunes one viewer and captures every byte it receives from then on. */
async function tune(baseUrl: string) {
  const { request, response } = await openStreamRequest(
    `${baseUrl}${STREAM_URL}`,
  );
  const tunedAt = Date.now();
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(chunk));
  return {
    request,
    response,
    tunedAt,
    capture: () => Buffer.concat(chunks),
  };
}

/** Resolves once a viewer has received broadcast bytes. */
async function receivesBytes(viewer: Awaited<ReturnType<typeof tune>>) {
  await vi.waitFor(
    () => expect(viewer.capture().byteLength).toBeGreaterThan(0),
    {
      timeout: 5_000,
      interval: 50,
    },
  );
}

/** Waits on the real clock until `time`, so steps land around boundaries. */
function sleepUntil(time: number): Promise<void> {
  const delayMs = Math.max(0, time - Date.now());
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

/** Reads one row from the first entries, failing when the schedule is short. */
function entryAt<T>(entries: readonly T[], index: number): T {
  const entry = entries[index];
  if (entry === undefined) throw new Error(`No schedule entry ${index}`);
  return entry;
}

describe("real FFmpeg channel stream", () => {
  it(
    "joins mid-item, shares one pipeline, and crosses a real boundary for both viewers",
    async () => {
      const { baseUrl, packager, entries } = await startRealChannel();
      const first = entryAt(entries, 0);
      const second = entryAt(entries, 1);
      await sleepUntil(first.starts_at + 2_000);

      const early = await tune(baseUrl);
      const late = await tune(baseUrl);
      await sleepUntil(second.starts_at + 3_000);

      expect(early.response.statusCode).toBe(200);
      expect(late.response.statusCode).toBe(200);
      // One worker and one session serve both viewers.
      expect(packager.sessions).toHaveLength(1);
      const session = packager.sessions[0];
      expect(session?.initialItem).toMatchObject({
        scheduleEntryId: first.id,
        mediaItemId: first.media_item_id,
      });
      // Joined in progress from the offset resolved at tune time. This bounds
      // startup latency only; drift at first output is Plex-measured evidence.
      const offsetMs = session?.initialItem.mediaOffsetMs ?? 0;
      expect(offsetMs).toBeGreaterThanOrEqual(2_000);
      expect(offsetMs).toBeLessThan(2_000 + DRIFT_CEILING_MS);
      // The following entry committed at its boundary, never before it.
      expect(session?.commits).toHaveLength(1);
      expect(session?.commits[0]?.item.scheduleEntryId).toBe(second.id);
      expect(session?.commits[0]?.committedAt).toBeGreaterThanOrEqual(
        second.starts_at,
      );
      // Both viewers stayed connected across the file boundary.
      expect(early.response.closed).toBe(false);
      expect(late.response.closed).toBe(false);
      // The broadcast is paced to the wall clock and decodes for each viewer.
      const watchedMs = Date.now() - early.tunedAt;
      const decodedMs = decodedVideoMs(early.capture());
      expect(Math.abs(decodedMs - watchedMs)).toBeLessThan(DRIFT_CEILING_MS);
      expect(decodedVideoMs(late.capture())).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps the current item through a regeneration and transitions to the new selection",
    async () => {
      const { server, baseUrl, packager, entries } = await startRealChannel();
      const first = entryAt(entries, 0);
      const stale = entryAt(entries, 1);
      await sleepUntil(first.starts_at + 1_000);
      const viewer = await tune(baseUrl);
      // Wait until the worker holds the old following entry as its preparation.
      await vi.waitFor(
        () =>
          expect(packager.sessions[0]?.prepared[0]?.scheduleEntryId).toBe(
            stale.id,
          ),
        { timeout: MEDIA_DURATION_MS, interval: 50 },
      );

      // Regeneration takes write authority as soon as the change arrives, so a
      // change sent before the boundary wins the race against the transition
      // even when its first chunk commits after the boundary. A later send
      // would test the other ordering, so say so plainly.
      expect(Date.now(), "regeneration sent after the boundary").toBeLessThan(
        first.ends_at,
      );
      const replaced = await send(
        server,
        "PATCH",
        `/channels/${CHANNEL_ID}/programming-blocks/${programmingBlockFixture.id}`,
        { source: { kind: "media_item", mediaItemId: "item-003" } },
      );
      await sleepUntil(first.ends_at + 3_000);

      expect(replaced.status).toBe(200);
      const session = packager.sessions[0];
      // The airing item was never restarted or cut short.
      expect(packager.sessions).toHaveLength(1);
      expect(session?.commits).toHaveLength(1);
      const commit = session?.commits[0];
      // The stale preparation was replaced by a fresh one and never aired;
      // the regenerated entry did, on time.
      expect(session?.prepared.map((item) => item.scheduleEntryId)).toEqual([
        stale.id,
        commit?.item.scheduleEntryId,
      ]);
      expect(commit?.item.scheduleEntryId).not.toBe(stale.id);
      expect(commit?.item.mediaItemId).toBe("item-003");
      expect(commit?.committedAt).toBeGreaterThanOrEqual(first.ends_at);
      expect(viewer.response.closed).toBe(false);
      expect(decodedVideoMs(viewer.capture())).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("real FFmpeg runtime cleanup", () => {
  // Spec 0006's idle grace as composed for the server.
  const IDLE_GRACE_MS = 5_000;

  /** Starts a channel with one viewer receiving bytes from a live FFmpeg child. */
  async function startWatchedChannel() {
    const channel = await startRealChannel();
    const viewer = await tune(channel.baseUrl);
    await receivesBytes(viewer);
    // Proves the leak check can see this suite's children at all.
    expect(runningFfmpegProcesses(fixtureDirectory)).toHaveLength(1);
    return { ...channel, viewer };
  }

  /** Asserts the channel left no child, timer, or open viewer behind. */
  async function expectNothingLeft(
    channel: Awaited<ReturnType<typeof startWatchedChannel>>,
    viewers: readonly Awaited<ReturnType<typeof tune>>[],
  ) {
    expect(channel.packager.sessions.every((s) => s.stopped)).toBe(true);
    expect(runningFfmpegProcesses(fixtureDirectory)).toEqual([]);
    expect(channel.runtime.pendingTimerCount).toBe(0);
    for (const viewer of viewers) {
      await settleWithin(responseFinished(viewer.response), 2_000, "viewer");
    }
  }

  it(
    "reuses the worker for a viewer returning in grace, then stops after the last leaves",
    async () => {
      const channel = await startWatchedChannel();
      channel.viewer.request.destroy();
      await sleepUntil(Date.now() + 1_000);

      const returning = await tune(channel.baseUrl);
      await receivesBytes(returning);
      expect(channel.packager.sessions).toHaveLength(1);
      expect(channel.packager.sessions[0]?.stopped).toBe(false);

      returning.request.destroy();
      await vi.waitFor(
        () => expect(channel.packager.sessions[0]?.stopped).toBe(true),
        { timeout: IDLE_GRACE_MS + 5_000, interval: 100 },
      );
      await expectNothingLeft(channel, [channel.viewer, returning]);
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    {
      change: "disable",
      method: "PATCH",
      body: { enabled: false },
      status: 200,
    },
    { change: "delete", method: "DELETE", body: undefined, status: 204 },
  ] as const)(
    "settles FFmpeg before a $change answers",
    async ({ method, body, status }) => {
      const channel = await startWatchedChannel();

      const response = await send(
        channel.server,
        method,
        `/channels/${CHANNEL_ID}`,
        body,
      );

      expect(response.status).toBe(status);
      await expectNothingLeft(channel, [channel.viewer]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "ends every viewer and settles FFmpeg when the server closes",
    async () => {
      const channel = await startWatchedChannel();
      const second = await tune(channel.baseUrl);
      await receivesBytes(second);

      await settleWithin(channel.server.close(), 10_000, "server close");

      await expectNothingLeft(channel, [channel.viewer, second]);
    },
    TEST_TIMEOUT_MS,
  );
});
