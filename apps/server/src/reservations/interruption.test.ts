// Interrupting reservations (programming spec 0007, ADR 0015): a special the
// owner marks as interrupting may start inside the airing item, now or
// later, and every playout read, the guide, and XMLTV end the item there.
import { afterEach, describe, expect, it } from "vitest";

import { iso, send, windowUrl } from "../testing/api-requests.js";
import { captureLogLines } from "../testing/captured-log-lines.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import {
  insertMovie,
  readGuideAirings,
  reserveItems,
} from "../testing/reservation-fixtures.js";
import {
  insertCollectionOfItems,
  readOnlyScheduleState,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import type { RecordingChannelRuntime } from "../testing/recording-channel-runtime.js";
import { startScheduleScenarioServer } from "../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";
import {
  readGuideProgrammes,
  xmltvTimestamp,
} from "../testing/xmltv-programmes.js";
import { SqliteTransitionCoordinator } from "../channels/runtime/sqlite-transition-coordinator.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
const at = (minutes: number) => T0 + minutes * MINUTE;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = "channel-fixture-001";
const URL = `/channels/${CHANNEL_ID}/reservations`;

// The episode scenario covered from T0, a 90-minute movie, and the clock
// five minutes into the first episode, which airs 0-22.
async function airingFirstEpisode(
  options: Parameters<typeof startScheduleScenarioServer>[1] = {},
) {
  const context = await startScheduleScenarioServer({}, options);
  const movie = await insertMovie(context.db);
  await send(
    context.server,
    "GET",
    windowUrl(`/channels/${CHANNEL_ID}/schedule`, T0, at(60)),
  );
  context.clock.set(at(5));
  return { ...context, movie };
}

// The recording runtime the scenario server composes by default.
function runtimeOf(context: Awaited<ReturnType<typeof airingFirstEpisode>>) {
  return context.dependencies.channelRuntime as RecordingChannelRuntime;
}

// The fixture channel's notices to its stream worker, in order.
function notices(context: Awaited<ReturnType<typeof airingFirstEpisode>>) {
  return runtimeOf(context).scheduleChanges;
}

// Filler airs 45-60 before a movie reserved at 60, with the clock at 50
// and a five-minute clip to cut in with.
async function airingFiller() {
  const context = await startScheduleScenarioServer();
  const movie = await insertMovie(context.db);
  const [clip = ""] = await insertCollectionOfItems(context.db, "clips", [
    5 * MINUTE,
  ]);
  await reserveItems(context.server, at(60), [movie]);
  context.clock.set(at(50));
  return { ...context, movie, clip };
}

// What airs at `minutes` on the fixture channel's now route.
async function airingAt(
  server: Awaited<ReturnType<typeof airingFiller>>["server"],
  minutes: number,
) {
  const now = await send(
    server,
    "GET",
    `/channels/${CHANNEL_ID}/now?at=${iso(at(minutes))}`,
  );
  return now.body.currentItem as Record<string, unknown>;
}

describe("interrupting reservations", () => {
  it("cuts the airing episode at a later start inside it, in the guide and XMLTV", async () => {
    const context = await airingFirstEpisode();
    const { server, db, movie } = context;
    const revision = (await readOnlyScheduleState(db)).schedule_revision;

    const created = await send(server, "POST", URL, {
      startsAt: iso(at(10)),
      interrupts: true,
      source: { kind: "media_items", mediaItemIds: [movie] },
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      startsAt: iso(at(10)),
      endsAt: iso(at(100)),
      interrupts: true,
    });
    // The cut episode counts as aired, so ordinary programming resumes with
    // the second one.
    await expect(readGuideAirings(server, T0, at(125))).resolves.toEqual([
      "item-001@0-10",
      `${movie}@10-100`,
      "item-002@100-123",
      "item-003@123-147",
    ]);
    expect((await readOnlyScheduleState(db)).schedule_revision).toBe(
      revision + 1,
    );
    const xmltv = await server.inject({
      method: "GET",
      url: "/plex/xmltv.xml",
    });
    expect(readGuideProgrammes(xmltv.body)[0]).toMatchObject({
      start: xmltvTimestamp(at(0)),
      stop: xmltvTimestamp(at(10)),
    });
    expect(notices(context)).toEqual([CHANNEL_ID]);
  });

  it("refuses the same start without the flag, and a flagged start already past", async () => {
    const { server, db, movie } = await airingFirstEpisode();
    const revision = (await readOnlyScheduleState(db)).schedule_revision;

    const unflagged = await send(server, "POST", URL, {
      startsAt: iso(at(10)),
      source: { kind: "media_items", mediaItemIds: [movie] },
    });
    const past = await send(server, "POST", URL, {
      startsAt: iso(at(3)),
      interrupts: true,
      source: { kind: "media_items", mediaItemIds: [movie] },
    });

    expect(unflagged.status).toBe(409);
    expect(unflagged.body.error).toMatchObject({
      code: "reservation_crosses_airing",
      airingEndsAt: iso(at(22)),
    });
    expect(past.body.error.code).toBe("reservation_in_past");
    expect((await readOnlyScheduleState(db)).schedule_revision).toBe(revision);
  });

  it("starts now on the server clock, and refuses now without the flag while something airs", async () => {
    const { server, movie } = await airingFirstEpisode();

    const unflagged = await send(server, "POST", URL, {
      startsAt: "now",
      source: { kind: "media_items", mediaItemIds: [movie] },
    });
    const created = await send(server, "POST", URL, {
      startsAt: "now",
      interrupts: true,
      source: { kind: "media_items", mediaItemIds: [movie] },
    });

    expect(unflagged.body.error.code).toBe("reservation_crosses_airing");
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      startsAt: iso(at(5)),
      endsAt: iso(at(95)),
    });
    await expect(readGuideAirings(server, T0, at(100))).resolves.toEqual([
      "item-001@0-5",
      `${movie}@5-95`,
      "item-002@95-118",
    ]);
  });

  it("replaces an entry that only starts now when a special starts now", async () => {
    const { server, clock, movie } = await airingFirstEpisode();
    clock.set(T0);

    await reserveItems(server, "now", [movie], undefined, {
      interrupts: true,
    });

    // The first episode aired nothing, so it returns to rotation after.
    await expect(readGuideAirings(server, T0, at(100))).resolves.toEqual([
      `${movie}@0-90`,
      "item-001@90-112",
    ]);
  });

  it("restores the airing episode's full airtime when the special is cancelled or moved before its start", async () => {
    const context = await airingFirstEpisode();
    const { server, movie } = context;
    const reservation = await reserveItems(server, at(10), [movie], undefined, {
      interrupts: true,
    });

    // An unflagged edit is judged against the episode's full airtime.
    const unflagged = await send(server, "PATCH", reservation, {
      startsAt: iso(at(15)),
      source: { kind: "media_items", mediaItemIds: [movie] },
    });
    const moved = await send(server, "PATCH", reservation, {
      startsAt: iso(at(15)),
      interrupts: true,
      source: { kind: "media_items", mediaItemIds: [movie] },
    });
    const movedGuide = await readGuideAirings(server, T0, at(110));
    const deleted = await send(server, "DELETE", reservation);

    expect(unflagged.body.error).toMatchObject({
      code: "reservation_crosses_airing",
      airingEndsAt: iso(at(22)),
    });
    expect(moved.status).toBe(200);
    expect(movedGuide).toEqual([
      "item-001@0-15",
      `${movie}@15-105`,
      "item-002@105-128",
    ]);
    expect(deleted.status).toBe(204);
    await expect(readGuideAirings(server, T0, at(69))).resolves.toEqual([
      "item-001@0-22",
      "item-002@22-45",
      "item-003@45-69",
    ]);
    expect(notices(context)).toEqual([CHANNEL_ID, CHANNEL_ID, CHANNEL_ID]);
  });

  it("cuts airing filler at the special's start and keeps the reservation it led into", async () => {
    const context = await startScheduleScenarioServer();
    const { server, db, clock } = context;
    const movie = await insertMovie(db);
    const [clip = ""] = await insertCollectionOfItems(db, "clips", [
      5 * MINUTE,
    ]);
    // Filler airs 45-60 before the movie reserved at 60.
    await reserveItems(server, at(60), [movie]);
    clock.set(at(50));

    const unflagged = await send(server, "POST", URL, {
      startsAt: iso(at(52)),
      source: { kind: "media_items", mediaItemIds: [clip] },
    });
    await reserveItems(server, at(52), [clip], undefined, { interrupts: true });
    const now = await send(
      server,
      "GET",
      `/channels/${CHANNEL_ID}/now?at=${iso(at(51))}`,
    );
    const window = await send(
      server,
      "GET",
      windowUrl(`/channels/${CHANNEL_ID}/schedule`, at(40), at(70)),
    );

    expect(unflagged.body.error.code).toBe("reservation_crosses_airing");
    expect(now.body.currentItem).toMatchObject({
      type: "filler",
      startsAt: iso(at(45)),
      endsAt: iso(at(52)),
    });
    expect(window.body.fillerIntervals).toMatchObject([
      { startsAt: iso(at(45)), endsAt: iso(at(52)) },
      { startsAt: iso(at(57)), endsAt: iso(at(60)) },
    ]);
  });

  it("refuses at the old boundary a preparation made before the cut, and commits the special at the cut", async () => {
    const { server, db, clock, movie } = await airingFirstEpisode();
    const before = await readOnlyScheduleState(db);
    const second = (await readScheduleEntries(db, CHANNEL_ID)).find(
      (entry) => entry.starts_at === at(22),
    );
    await reserveItems(server, at(10), [movie], undefined, {
      interrupts: true,
    });
    const after = await readOnlyScheduleState(db);
    const special = (await readScheduleEntries(db, CHANNEL_ID)).find(
      (entry) => entry.starts_at === at(10),
    );
    const coordinator = new SqliteTransitionCoordinator(db, clock.now, {
      writeAuthorityWaitMs: 1_000,
    });
    let committed = 0;

    clock.set(at(10));
    const atCut = await coordinator.commitPreparedTransition(
      {
        channelId: CHANNEL_ID,
        cursor: { kind: "program", scheduleEntryId: special?.id ?? "" },
        scheduleRevision: after.schedule_revision,
      },
      () => (committed += 1),
    );
    clock.set(at(22));
    const atOldBoundary = await coordinator.commitPreparedTransition(
      {
        channelId: CHANNEL_ID,
        cursor: { kind: "program", scheduleEntryId: second?.id ?? "" },
        scheduleRevision: before.schedule_revision,
      },
      () => (committed += 1),
    );

    expect(atCut).toBe("committed");
    expect(atOldBoundary).toBe("stale");
    expect(committed).toBe(1);
  });

  it("previews an interrupting special from its cut, and an unflagged one as the crossing it is", async () => {
    const { server, movie } = await airingFirstEpisode();
    const body = (interrupts: boolean) => ({
      startsAt: iso(at(10)),
      interrupts,
      source: { kind: "media_items", mediaItemIds: [movie] },
    });

    const flagged = await send(server, "POST", `${URL}/preview`, body(true));
    const unflagged = await send(server, "POST", `${URL}/preview`, body(false));

    expect(flagged.body).toMatchObject({
      startsAt: iso(at(10)),
      endsAt: iso(at(100)),
      programs: [{ mediaItemId: movie, startsAt: iso(at(10)) }],
      fillerBefore: null,
      conflicts: [],
    });
    expect(unflagged.body.conflicts).toMatchObject([
      { code: "reservation_crosses_airing", airingEndsAt: iso(at(22)) },
    ]);
  });

  it("logs a failed worker notice without undoing the saved special", async () => {
    const { lines, stream } = captureLogLines();
    const context = await airingFirstEpisode({
      logger: { level: "warn", stream },
    });
    runtimeOf(context).noticeFailure = new Error("worker unreachable");

    const created = await send(context.server, "POST", URL, {
      startsAt: iso(at(10)),
      interrupts: true,
      source: { kind: "media_items", mediaItemIds: [context.movie] },
    });

    expect(created.status).toBe(201);
    await expect(send(context.server, "GET", URL)).resolves.toMatchObject({
      body: [{ startsAt: iso(at(10)) }],
    });
    expect(lines).toContainEqual(
      expect.objectContaining({
        msg: "Reservation saved but notifying the channel stream worker failed",
        channelId: CHANNEL_ID,
      }),
    );
  });

  it("restores the airing filler's resume time when a cut into it is cancelled or moved", async () => {
    const { server, clip } = await airingFiller();
    const special = await reserveItems(server, at(52), [clip], undefined, {
      interrupts: true,
    });

    const unflagged = await send(server, "PATCH", special, {
      startsAt: iso(at(54)),
      source: { kind: "media_items", mediaItemIds: [clip] },
    });
    const moved = await send(server, "PATCH", special, {
      startsAt: iso(at(54)),
      interrupts: true,
      source: { kind: "media_items", mediaItemIds: [clip] },
    });
    const afterMove = await airingAt(server, 51);
    const deleted = await send(server, "DELETE", special);

    expect(unflagged.body.error).toMatchObject({
      code: "reservation_crosses_airing",
      airingEndsAt: iso(at(60)),
    });
    expect(moved.status).toBe(200);
    expect(afterMove).toMatchObject({ type: "filler", endsAt: iso(at(54)) });
    expect(deleted.status).toBe(204);
    await expect(airingAt(server, 51)).resolves.toMatchObject({
      type: "filler",
      startsAt: iso(at(45)),
      endsAt: iso(at(60)),
    });
    await expect(readGuideAirings(server, at(40), at(70))).resolves.toEqual([
      "item-002@22-45",
      "movies-1@60-150",
    ]);
  });

  it("keeps the program a special interrupted cut in history when the started special is deleted", async () => {
    const { server, clock, movie } = await airingFirstEpisode();
    const special = await reserveItems(server, at(10), [movie], undefined, {
      interrupts: true,
    });
    clock.set(at(20));

    const deleted = await send(server, "DELETE", special);

    // The airing movie stays; ordinary programming returns after it.
    expect(deleted.status).toBe(204);
    await expect(readGuideAirings(server, T0, at(110))).resolves.toEqual([
      "item-001@0-10",
      `${movie}@10-100`,
      "item-002@100-123",
    ]);
  });

  it("leaves an ordinary reserved program untouched by a write at the instant it starts", async () => {
    const { server, db, clock } = await airingFiller();
    const movieEntry = async () =>
      (await readScheduleEntries(db, CHANNEL_ID)).find(
        (entry) => entry.starts_at === at(60),
      )?.id;
    const before = await movieEntry();
    clock.set(at(60));

    await reserveItems(server, at(400), ["item-001"]);

    expect(before).toBeDefined();
    await expect(movieEntry()).resolves.toBe(before);
  });

  it("stores the flag only on a special that cuts what airs", async () => {
    const { server, movie } = await airingFirstEpisode();

    const later = await send(server, "POST", URL, {
      startsAt: iso(at(300)),
      interrupts: true,
      source: { kind: "media_items", mediaItemIds: [movie] },
    });

    expect(later.body).toMatchObject({
      startsAt: iso(at(300)),
      interrupts: false,
    });
  });

  it("refuses an explicit end at or before a start of now", async () => {
    const { server, movie } = await airingFirstEpisode();

    const refused = await send(server, "POST", URL, {
      startsAt: "now",
      endsAt: iso(at(4)),
      interrupts: true,
      source: { kind: "media_items", mediaItemIds: [movie] },
    });

    expect(refused.body.error.code).toBe("reservation_in_past");
  });

  it("never reports a program a special cut as airing for catalog removal", async () => {
    const { server, clock, movie } = await airingFirstEpisode();
    await reserveItems(server, at(10), [movie], undefined, {
      interrupts: true,
    });
    clock.set(at(15));

    // The interrupted episode is stored as covering 15, but its cut ended it.
    const preview = await send(server, "POST", "/catalog-removals/preview", {
      target: { mediaItemIds: ["item-001"] },
      airing: "finish",
      allowUnschedulable: true,
    });

    expect(preview.status).toBe(200);
    expect(preview.body.airing).toEqual([]);
  });

  it("drops a moved-earlier special's old programs and cuts at its new start", async () => {
    const { server, movie } = await airingFirstEpisode();
    const special = await reserveItems(server, at(15), [movie], undefined, {
      interrupts: true,
    });

    await send(server, "PATCH", special, {
      startsAt: iso(at(10)),
      interrupts: true,
      source: { kind: "media_items", mediaItemIds: [movie] },
    });

    await expect(readGuideAirings(server, T0, at(110))).resolves.toEqual([
      "item-001@0-10",
      `${movie}@10-100`,
      "item-002@100-123",
    ]);
  });

  it("clears the flag when a fresh rebuild replaces the item the special cut", async () => {
    const { server, movie } = await airingFirstEpisode();
    await reserveItems(server, at(10), [movie], undefined, {
      interrupts: true,
    });

    const rebuilt = await send(
      server,
      "POST",
      `/channels/${CHANNEL_ID}/programming/rebuild`,
      { idempotencyKey: "rebuild-1" },
    );

    expect(rebuilt.status).toBe(200);
    await expect(send(server, "GET", URL)).resolves.toMatchObject({
      body: [{ startsAt: iso(at(10)), interrupts: false }],
    });
  });

  it("writes an aired cut into history when the ended special goes with its media", async () => {
    const { server, db, clock, movie } = await airingFirstEpisode();
    await reserveItems(server, at(10), [movie], undefined, {
      interrupts: true,
    });
    clock.set(at(200));

    const removed = await send(server, "POST", "/catalog-removals", {
      target: { mediaItemIds: [movie] },
      airing: "finish",
      allowUnschedulable: true,
    });

    expect(removed.status).toBe(200);
    await expect(send(server, "GET", URL)).resolves.toMatchObject({ body: [] });
    const episode = (await readScheduleEntries(db, CHANNEL_ID)).find(
      (entry) => entry.starts_at === T0,
    );
    expect(episode).toMatchObject({
      ends_at: at(10),
      duration_ms: 10 * MINUTE,
    });
  });
});
