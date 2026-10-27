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
import { parseFfmpegFontFile } from "../src/config/ffmpeg.js";
import { toSignalLogger } from "../src/channels/runtime/signal-log.js";
import { PlayoutService } from "../src/playout/playout-service.js";
import { ScheduleService } from "../src/schedules/schedule-service.js";
import { iso, send } from "../src/testing/api-requests.js";
import { itemAssignment } from "../src/testing/assignment-bodies.js";
import { assignmentFixture } from "../src/testing/channel-fixtures.js";
import {
  decodedVideoMs,
  ffmpegPath,
  generateMediaFile,
  runningFfmpegProcesses,
} from "../src/testing/real-ffmpeg.js";
import { RecordingSignalPackager } from "../src/testing/recording-signal-packager.js";
import { saveReservation } from "../src/testing/reservation-fixtures.js";
import {
  seedScheduleScenario,
  type ScheduleItemSpec,
} from "../src/testing/schedule-fixtures.js";
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
// The last item is cataloged as an hour long, so it airs for an hour, though
// its file holds six seconds: FFmpeg ends there and the signal goes quiet. No
// test reaches it. Uniform six-second airtimes would materialize 43,200
// entries over the horizon, and regenerating them holds write authority long
// enough under load to push a boundary past the worker's recovery deadline.
const LAST_AIRTIME_MS = 60 * 60_000;
const CHANNEL_ID = "channel-fixture-001";
const STREAM_URL = `/channels/${CHANNEL_ID}/stream`;
// Spec 0006's ceiling on initial tune drift at first usable output.
const DRIFT_CEILING_MS = 2_000;
const TEST_TIMEOUT_MS = 60_000;
// Cleanup tests check the teardown of one live FFmpeg child, so their first
// item is a real minute-long file. A six-second one ended on its own before a
// slow leak check could see it, and a boundary would start a second child
// before stopping the first. Their startup budget covers a busy machine, where
// production's 2s answers 503; startup latency is not under test there.
const CLEANUP_MEDIA_DURATION_MS = 60_000;
const CLEANUP_STARTUP_TIMEOUT_MS = 10_000;

let fixtureDirectory: string;
const mediaPaths: string[] = [];
let cleanupMediaPath: string;
const managers: ChannelStreamManagerContract[] = [];

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "krazitv-stream-e2e-"));
  for (const name of ["first", "second", "third"]) {
    mediaPaths.push(
      generateMediaFile(fixtureDirectory, name, MEDIA_DURATION_MS),
    );
  }
  cleanupMediaPath = generateMediaFile(
    fixtureDirectory,
    "cleanup",
    CLEANUP_MEDIA_DURATION_MS,
  );
}, TEST_TIMEOUT_MS);

// Shutdown plus the seconds-long process listing outgrew the 10s hook default
// under load, and a timed-out cleanup left children for the next test to count.
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  await cleanUpTestEnvironment();
  // A child that outlives its channel is a leak, whatever the test checked.
  expect(await runningFfmpegProcesses(fixtureDirectory)).toEqual([]);
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  if (fixtureDirectory !== undefined) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

/**
 * Boots the production composition over real media files programmed
 * chronologically, by default the three six-second files, so the schedule
 * anchors at server startup on the wall clock. The startup timeout defaults to
 * production's. Returns the first entries so tests can time tunes to boundaries.
 */
async function startRealChannel({
  items = mediaPaths.map((path, index) => ({
    durationMs:
      index === mediaPaths.length - 1 ? LAST_AIRTIME_MS : MEDIA_DURATION_MS,
    path,
  })),
  startupTimeoutMs,
}: {
  items?: readonly ScheduleItemSpec[];
  startupTimeoutMs?: number;
} = {}) {
  const runtime = new TrackedRuntime();
  const silent = pino({ level: "silent" });
  const packager = new RecordingSignalPackager(
    createFfmpegSignalPackager({
      logger: toSignalLogger(silent),
      timers: runtime,
      clock: runtime,
      ffmpegPath,
      // The font production resolves, so filler renders on every host.
      fillerFontFile: parseFfmpegFontFile(process.env, process.platform),
    }),
  );
  const { server, db } = await startTestServer({
    seed: async (db) => {
      await seedScheduleScenario(db, { items, source: "chronological" });
    },
    overrides: (db, defaults) => {
      const schedules = new ScheduleService(db);
      const playout = new PlayoutService(db, schedules);
      const manager = composeChannelStreamManager({
        db,
        playout,
        channels: defaults.channels,
        log: silent,
        programmingTimezone: "UTC",
        packager,
        runtime,
        startupTimeoutMs,
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

/**
 * Resolves once a viewer has received broadcast bytes. Checks the status
 * first: a refused tune also delivers bytes, its JSON error body.
 */
async function receivesBytes(viewer: Awaited<ReturnType<typeof tune>>) {
  expect(viewer.response.statusCode, "stream status").toBe(200);
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
      // Checked before the second file's last second. Its process starts a
      // prepare lead (3 s) early, so it reaches its six-second file's end at
      // `starts_at + 3_000` and flushes encoder lookahead at once, beyond the
      // held span ADR 0016 accepts ahead of the clock.
      await sleepUntil(second.starts_at + 2_000);

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
      const initial = session?.initialItem;
      const offsetMs = initial?.kind === "program" ? initial.mediaOffsetMs : 0;
      expect(offsetMs).toBeGreaterThanOrEqual(2_000);
      expect(offsetMs).toBeLessThan(2_000 + DRIFT_CEILING_MS);
      // The following entry committed at its boundary, never before it.
      expect(session?.commits).toHaveLength(1);
      expect(session?.commits[0]?.item).toMatchObject({
        scheduleEntryId: second.id,
      });
      expect(session?.commits[0]?.committedAt).toBeGreaterThanOrEqual(
        second.starts_at,
      );
      // Both viewers stayed connected across the file boundary.
      expect(early.response.closed).toBe(false);
      expect(late.response.closed).toBe(false);
      // The broadcast is paced to the wall clock and decodes for each viewer.
      // The first process burst the media before the tune offset, up to the
      // join backlog (ADR 0018), so the first viewer received that on top.
      const watchedMs = Date.now() - early.tunedAt;
      const decodedMs = decodedVideoMs(early.capture());
      expect(Math.abs(decodedMs - offsetMs - watchedMs)).toBeLessThan(
        DRIFT_CEILING_MS,
      );
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
      // A refused tune has no worker, so say so instead of timing out below.
      expect(viewer.response.statusCode, "stream status").toBe(200);
      // Wait until the worker holds the old following entry as its preparation.
      await vi.waitFor(
        () =>
          expect(packager.sessions[0]?.prepared[0]).toMatchObject({
            scheduleEntryId: stale.id,
          }),
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
        `/channels/${CHANNEL_ID}/programming-assignments/${assignmentFixture.id}`,
        itemAssignment("item-003"),
      );
      await sleepUntil(first.ends_at + 3_000);

      expect(replaced.status).toBe(200);
      const session = packager.sessions[0];
      // The airing item was never restarted or cut short.
      expect(packager.sessions).toHaveLength(1);
      expect(session?.commits).toHaveLength(1);
      const commit = session?.commits[0];
      const committed = commit?.item.kind === "program" ? commit.item : null;
      // The stale preparation was replaced by a fresh one and never aired;
      // the regenerated entry did, on time.
      expect(
        session?.prepared.map((item) =>
          item.kind === "program" ? item.scheduleEntryId : "filler",
        ),
      ).toEqual([stale.id, committed?.scheduleEntryId]);
      expect(committed?.scheduleEntryId).not.toBe(stale.id);
      expect(committed?.mediaItemId).toBe("item-003");
      expect(commit?.committedAt).toBeGreaterThanOrEqual(first.ends_at);
      expect(viewer.response.closed).toBe(false);
      expect(decodedVideoMs(viewer.capture())).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("real FFmpeg reserved start", () => {
  it(
    "airs filler and starts the reserved program within a second of its time on one signal",
    async () => {
      const { server, baseUrl, packager, entries } = await startRealChannel();
      const first = entryAt(entries, 0);
      // The next episode would end past the reservation, so filler covers
      // three seconds after the first one before the reserved program.
      const reservedAt = first.ends_at + 3_000;
      const created = await saveReservation(
        server,
        "POST",
        `/channels/${CHANNEL_ID}/reservations`,
        {
          startsAt: iso(reservedAt),
          source: { kind: "media_items", mediaItemIds: ["item-002"] },
        },
      );
      expect(created.status, "reservation status").toBe(201);
      await sleepUntil(first.starts_at + 1_000);
      const viewer = await tune(baseUrl);
      await receivesBytes(viewer);

      await sleepUntil(reservedAt + 2_000);

      expect(packager.sessions).toHaveLength(1);
      const commits = packager.sessions[0]?.commits ?? [];
      expect(commits.map(({ item }) => item.kind)).toEqual([
        "filler",
        "program",
      ]);
      const [filler, reserved] = commits;
      expect(filler?.committedAt).toBeGreaterThanOrEqual(first.ends_at);
      expect(filler?.committedAt).toBeLessThan(first.ends_at + 1_000);
      expect(reserved?.item).toMatchObject({ mediaItemId: "item-002" });
      // Spec 0006's exact start: within a second on the broadcast timeline.
      expect(reserved?.committedAt).toBeGreaterThanOrEqual(reservedAt);
      expect(reserved?.committedAt).toBeLessThan(reservedAt + 1_000);
      expect(viewer.response.closed).toBe(false);
      // One continuous decodable stream across both transitions: the viewer
      // received about as much video as wall time passed since tuning.
      const watchedMs = Date.now() - viewer.tunedAt;
      expect(decodedVideoMs(viewer.capture())).toBeGreaterThan(
        watchedMs - DRIFT_CEILING_MS,
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe("real FFmpeg cut", () => {
  it.each([
    { name: "at a later instant", startsAt: "later" as const },
    { name: "now", startsAt: "now" as const },
  ])(
    "cuts the airing program $name into the special within a second on one signal",
    async ({ startsAt }) => {
      const { server, baseUrl, packager, entries } = await startRealChannel();
      const first = entryAt(entries, 0);
      await sleepUntil(first.starts_at + 1_000);
      const viewer = await tune(baseUrl);
      await receivesBytes(viewer);
      // Two seconds into the six-second first program: cut it at three
      // seconds, or as soon as the owner saves.
      await sleepUntil(first.starts_at + 2_000);
      const savedAt = Date.now();

      const created = await saveReservation(
        server,
        "POST",
        `/channels/${CHANNEL_ID}/reservations`,
        {
          startsAt: startsAt === "now" ? "now" : iso(first.starts_at + 3_000),
          interrupts: true,
          source: { kind: "media_items", mediaItemIds: ["item-002"] },
        },
      );
      expect(created.status, "reservation status").toBe(201);
      const cutAt = Date.parse(created.body.startsAt as string);
      expect(cutAt).toBeGreaterThanOrEqual(savedAt - 1_000);
      await sleepUntil(cutAt + 2_000);

      expect(packager.sessions).toHaveLength(1);
      const [special] = packager.sessions[0]?.commits ?? [];
      expect(special?.item).toMatchObject({
        kind: "program",
        mediaItemId: "item-002",
      });
      // Spec 0007's exact-start tolerance: within a second of the cut.
      expect(special?.committedAt).toBeGreaterThanOrEqual(cutAt);
      expect(special?.committedAt).toBeLessThan(cutAt + 1_000);
      expect(viewer.response.closed).toBe(false);
      const watchedMs = Date.now() - viewer.tunedAt;
      expect(decodedVideoMs(viewer.capture())).toBeGreaterThan(
        watchedMs - DRIFT_CEILING_MS,
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe("real FFmpeg early end", () => {
  it(
    "ends a running special inside its program and cuts to ordinary programming within a second",
    async () => {
      const { server, baseUrl, packager, entries } = await startRealChannel();
      const first = entryAt(entries, 0);
      // The special airs the six-second second file from the first one's end.
      const reservation = await saveReservation(
        server,
        "POST",
        `/channels/${CHANNEL_ID}/reservations`,
        {
          startsAt: iso(first.ends_at),
          source: { kind: "media_items", mediaItemIds: ["item-002"] },
        },
      );
      expect(reservation.status, "reservation status").toBe(201);
      await sleepUntil(first.starts_at + 1_000);
      const viewer = await tune(baseUrl);
      await receivesBytes(viewer);
      await sleepUntil(first.ends_at + 1_000);
      const cutAt = first.ends_at + 3_000;

      const ended = await send(
        server,
        "POST",
        `/channels/${CHANNEL_ID}/reservations/${reservation.body.id as string}/end`,
        { endsAt: iso(cutAt) },
      );
      expect(ended.status, "end status").toBe(200);
      await sleepUntil(cutAt + 2_000);

      expect(packager.sessions).toHaveLength(1);
      expect(packager.sessions[0]?.commits).toHaveLength(2);
      const [special, resumed] = packager.sessions[0]?.commits ?? [];
      expect(special?.item).toMatchObject({ mediaItemId: "item-002" });
      // Ordinary programming resumes at the cut with its own entry: listed
      // items consume no progress, so rotation may air the same file.
      expect(resumed?.item).toMatchObject({
        kind: "program",
        mediaOffsetMs: 0,
      });
      expect(
        resumed?.item.kind === "program" && special?.item.kind === "program"
          ? resumed.item.scheduleEntryId !== special.item.scheduleEntryId
          : false,
      ).toBe(true);
      expect(resumed?.committedAt).toBeGreaterThanOrEqual(cutAt);
      expect(resumed?.committedAt).toBeLessThan(cutAt + 1_000);
      expect(viewer.response.closed).toBe(false);
      // One drift ceiling per transition: this viewer crosses two, into the
      // special and at the cut, and the cut also drops what the truncated
      // FFmpeg process had not yet emitted. Under the full suite's load the
      // shortfall measured about 2.4 seconds, past a single ceiling.
      const watchedMs = Date.now() - viewer.tunedAt;
      expect(decodedVideoMs(viewer.capture())).toBeGreaterThan(
        watchedMs - 2 * DRIFT_CEILING_MS,
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe("real FFmpeg runtime cleanup", () => {
  // Spec 0006's idle grace as composed for the server.
  const IDLE_GRACE_MS = 5_000;

  /** Starts a channel with one viewer receiving bytes from a live FFmpeg child. */
  async function startWatchedChannel() {
    const channel = await startRealChannel({
      items: [
        { durationMs: CLEANUP_MEDIA_DURATION_MS, path: cleanupMediaPath },
        ...mediaPaths
          .slice(-1)
          .map((path) => ({ durationMs: LAST_AIRTIME_MS, path })),
      ],
      startupTimeoutMs: CLEANUP_STARTUP_TIMEOUT_MS,
    });
    const viewer = await tune(channel.baseUrl);
    await receivesBytes(viewer);
    // Proves the leak check can see this suite's children at all.
    expect(await runningFfmpegProcesses(fixtureDirectory)).toHaveLength(1);
    return { ...channel, viewer };
  }

  /** Asserts the channel left no child, timer, or open viewer behind. */
  async function expectNothingLeft(
    channel: Awaited<ReturnType<typeof startWatchedChannel>>,
    viewers: readonly Awaited<ReturnType<typeof tune>>[],
  ) {
    expect(channel.packager.sessions.every((s) => s.stopped)).toBe(true);
    expect(await runningFfmpegProcesses(fixtureDirectory)).toEqual([]);
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
