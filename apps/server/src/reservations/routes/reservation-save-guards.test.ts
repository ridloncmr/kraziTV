// What a save must carry (programming spec 0007): the programming revision
// its preview read, a request key on a create, and a start at most a year
// ahead.
import { afterEach, describe, expect, it } from "vitest";

import { iso, send, windowUrl } from "../../testing/api-requests.js";
import { collectionAssignment } from "../../testing/assignment-bodies.js";
import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import { assignmentFixture } from "../../testing/channel-fixtures.js";
import {
  insertMovie,
  reserveItems,
  saveReservation,
} from "../../testing/reservation-fixtures.js";
import type { RecordingChannelRuntime } from "../../testing/recording-channel-runtime.js";
import { readOnlyScheduleState } from "../../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const T0 = FIXTURE_TIME;
const at = (minutes: number) => T0 + minutes * MINUTE;
const CHANNEL_ID = "channel-fixture-001";
const URL = `/channels/${CHANNEL_ID}/reservations`;
const SCHEDULE_URL = `/channels/${CHANNEL_ID}/schedule`;
const ASSIGNMENT = `/channels/${CHANNEL_ID}/programming-assignments/${assignmentFixture.id}`;

// The episode scenario with a 90-minute movie to reserve.
async function scenario() {
  const context = await startScheduleScenarioServer();
  const movie = await insertMovie(context.db);
  const movieAt = (startsAt: number) => ({
    startsAt: iso(startsAt),
    source: { kind: "media_items", mediaItemIds: [movie] },
  });
  const revision = async () =>
    (await readOnlyScheduleState(context.db)).programming_revision;
  return { ...context, movie, movieAt, revision };
}

describe("reservation save guards", () => {
  it("refuses a save made from a preview an unrelated edit made stale, writing nothing", async () => {
    const { server, movieAt, revision } = await scenario();
    const preview = await send(
      server,
      "POST",
      `${URL}/preview`,
      movieAt(at(60)),
    );
    await send(
      server,
      "PATCH",
      ASSIGNMENT,
      collectionAssignment("collection-fixture-001", "random"),
    );
    const afterEdit = await revision();

    const stale = await send(server, "POST", URL, {
      ...movieAt(at(60)),
      expectedProgrammingRevision: preview.body.programmingRevision,
      requestKey: "save-1",
    });

    expect(afterEdit).not.toBe(preview.body.programmingRevision);
    expect(stale.status).toBe(409);
    // The refusal names no revision, so only a fresh preview recovers.
    expect(stale.body.error.code).toBe("preview_stale");
    expect(stale.body.error.programmingRevision).toBeUndefined();
    expect(await revision()).toBe(afterEdit);
    await expect(send(server, "GET", URL)).resolves.toMatchObject({ body: [] });
  });

  it("saves from a preview after a guide read extended coverage meanwhile", async () => {
    const { server, db, clock, movieAt, revision } = await scenario();
    const preview = await send(
      server,
      "POST",
      `${URL}/preview`,
      movieAt(T0 + 5 * DAY),
    );
    const before = await readOnlyScheduleState(db);
    // A day later, a guide read extends coverage a full horizon past the
    // new time: the schedule revision moves, the planned programming the
    // preview showed does not.
    clock.set(T0 + DAY);
    await send(server, "GET", windowUrl(SCHEDULE_URL, T0 + DAY, T0 + DAY + 1));
    const extended = await readOnlyScheduleState(db);

    const saved = await send(server, "POST", URL, {
      ...movieAt(T0 + 5 * DAY),
      expectedProgrammingRevision: preview.body.programmingRevision,
      requestKey: "save-1",
    });

    expect(extended.schedule_revision).toBeGreaterThan(
      before.schedule_revision,
    );
    expect(extended.programming_revision).toBe(before.programming_revision);
    expect(saved.status).toBe(201);
    expect(await revision()).toBe(before.programming_revision + 1);
  });

  it("refuses an edit made from a stale preview", async () => {
    const { server, movie, movieAt } = await scenario();
    const reservation = await reserveItems(server, at(60), [movie]);

    const stale = await send(server, "PATCH", reservation, {
      ...movieAt(at(120)),
      expectedProgrammingRevision: 0,
    });

    expect(stale.body.error.code).toBe("preview_stale");
  });

  it("answers a retried save with what the first one created, regenerating nothing", async () => {
    const { server, dependencies, movieAt, revision } = await scenario();
    const body = { ...movieAt(at(60)), requestKey: "save-1" };

    const first = await saveReservation(server, "POST", URL, body);
    const afterFirst = await revision();
    // The retry carries the preview's revision, which the first save advanced.
    const retry = await saveReservation(server, "POST", URL, {
      ...body,
      expectedProgrammingRevision: afterFirst - 1,
    });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(await revision()).toBe(afterFirst);
    await expect(send(server, "GET", URL)).resolves.toMatchObject({
      body: [{ id: first.body.id }],
    });
    // Only the first save changed the schedule, so only it told the worker.
    expect(
      (dependencies.channelRuntime as RecordingChannelRuntime).scheduleChanges,
    ).toEqual([CHANNEL_ID]);
  });

  it("refuses a start more than a year ahead in preview and save", async () => {
    const { server, movieAt } = await scenario();
    const tooFar = movieAt(T0 + 366 * DAY);

    const preview = await send(server, "POST", `${URL}/preview`, tooFar);
    const saved = await saveReservation(server, "POST", URL, tooFar);
    const yearAhead = await saveReservation(
      server,
      "POST",
      URL,
      movieAt(T0 + 365 * DAY),
    );

    expect(preview.body.conflicts).toMatchObject([
      { code: "reservation_too_far", latestStartsAt: iso(T0 + 365 * DAY) },
    ]);
    expect(saved.status).toBe(409);
    expect(saved.body.error.code).toBe("reservation_too_far");
    expect(yearAhead.status).toBe(201);
  });

  it.each([
    {
      name: "a create without a preview revision",
      omit: "expectedProgrammingRevision",
    },
    { name: "a create without a request key", omit: "requestKey" },
  ])("refuses $name as invalid", async ({ omit }) => {
    const { server, movieAt } = await scenario();
    const body: Record<string, unknown> = {
      ...movieAt(at(60)),
      expectedProgrammingRevision: null,
      requestKey: "save-1",
    };
    delete body[omit];

    const refused = await send(server, "POST", URL, body);

    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("invalid_request");
  });

  it("refuses an edit without a preview revision as invalid", async () => {
    const { server, movie, movieAt } = await scenario();
    const reservation = await reserveItems(server, at(60), [movie]);

    const refused = await send(server, "PATCH", reservation, movieAt(at(120)));

    expect(refused.status).toBe(400);
  });

  it("saves a special from its preview on a channel with no ordinary programming", async () => {
    const { server, movieAt } = await scenario();
    await send(server, "DELETE", ASSIGNMENT);

    const saved = await saveReservation(server, "POST", URL, movieAt(at(60)));

    expect(saved.status).toBe(201);
  });
});
