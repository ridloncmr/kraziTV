// Planned filler on the signal port (programming spec 0006, ADR 0014): the
// adapter words it in the programming timezone, following selection walks
// through it, and the coordinator revalidates it by its end.
import { afterEach, describe, expect, it, vi } from "vitest";

import { iso, send, windowUrl } from "../../testing/api-requests.js";
import {
  readGuideProgrammes,
  xmltvTimestamp,
} from "../../testing/xmltv-programmes.js";
import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import { recordingLog } from "../../testing/recording-log.js";
import {
  readOnlyScheduleState,
  readScheduleEntries,
} from "../../testing/schedule-fixtures.js";
import {
  insertMovie,
  reserveItems,
  saveReservation,
} from "../../testing/reservation-fixtures.js";
import { startScheduleScenarioServer } from "../../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";
import { resumeMessage } from "../../playout/resume-message.js";
import { SignalPlayoutAdapter } from "./signal-playout-adapter.js";
import { SqliteTransitionCoordinator } from "./sqlite-transition-coordinator.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
const at = (minutes: number) => T0 + minutes * MINUTE;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = "channel-fixture-001";
// 01:00 UTC on 2024-01-01 is 7:00 PM the evening before in Chicago.
const TIME_ZONE = "America/Chicago";
const MESSAGE = "Programming resumes at 7:00 PM";

// The episodes air 0-22 and 22-45; the third would end at 69, so filler
// covers 45-60 before a 90-minute movie reserved at 60.
async function reservedAtSixty() {
  const context = await startScheduleScenarioServer();
  const movie = await insertMovie(context.db);
  const reservationUrl = await reserveItems(context.server, at(60), [movie]);
  const adapter = new SignalPlayoutAdapter(
    context.dependencies.playout,
    context.dependencies.channels,
    recordingLog(),
    TIME_ZONE,
  );
  const coordinator = new SqliteTransitionCoordinator(
    context.db,
    context.clock.now,
    { writeAuthorityWaitMs: 1_000 },
  );
  return {
    ...context,
    adapter,
    coordinator,
    reservationUrl,
  };
}

describe("resumeMessage", () => {
  it("words the resume time in the programming timezone, in 12-hour form with plain spaces", () => {
    expect(resumeMessage(at(60), TIME_ZONE)).toBe(MESSAGE);
    expect(resumeMessage(Date.parse("2024-01-01T20:30:00Z"), "UTC")).toBe(
      "Programming resumes at 8:30 PM",
    );
  });
});

describe("planned filler on the signal port", () => {
  it("answers a tune during filler with the filler, its join offset, and its message", async () => {
    const { adapter, db } = await reservedAtSixty();

    const current = await adapter.getCurrent(CHANNEL_ID, at(50));

    expect(current).toEqual({
      status: "current",
      channelId: CHANNEL_ID,
      scheduleRevision: (await readOnlyScheduleState(db)).schedule_revision,
      evaluatedAt: at(50),
      mediaOffsetMs: 5 * MINUTE,
      item: {
        kind: "filler",
        channelId: CHANNEL_ID,
        scheduleRevision: (await readOnlyScheduleState(db)).schedule_revision,
        startsAt: at(45),
        endsAt: at(60),
        message: MESSAGE,
      },
    });
  });

  it("walks following selection from the program into filler and from filler into the reserved program", async () => {
    const { adapter, db } = await reservedAtSixty();
    // Saving the reservation regenerated the second episode under a new ID.
    const second = (await readScheduleEntries(db, CHANNEL_ID)).find(
      (entry) => entry.ends_at === at(45),
    );

    const afterProgram = await adapter.getFollowing(
      CHANNEL_ID,
      { kind: "program", scheduleEntryId: second?.id ?? "" },
      2,
    );
    const afterFiller = await adapter.getFollowing(
      CHANNEL_ID,
      { kind: "filler", endsAt: at(60) },
      1,
    );

    expect(afterProgram).toMatchObject({
      status: "selected",
      items: [
        { kind: "filler", startsAt: at(45), endsAt: at(60) },
        { kind: "program", mediaItemId: "movies-1", startsAt: at(60) },
      ],
    });
    expect(afterFiller).toMatchObject({
      status: "selected",
      items: [{ kind: "program", mediaItemId: "movies-1", startsAt: at(60) }],
    });
  });

  it("reports filler as current on the now route instead of a schedule gap", async () => {
    const { server } = await reservedAtSixty();

    const now = await send(
      server,
      "GET",
      `/channels/${CHANNEL_ID}/now?at=${iso(at(50))}`,
    );

    expect(now.body).toMatchObject({
      currentItem: {
        type: "filler",
        startsAt: iso(at(45)),
        endsAt: iso(at(60)),
        offsetMs: 5 * MINUTE,
      },
      nextItem: { type: "program", mediaItemId: "movies-1" },
    });
    expect(now.body.reason).toBeUndefined();
  });

  it("commits a prepared filler at its boundary while it still ends where its cursor says", async () => {
    const { coordinator, clock, db } = await reservedAtSixty();
    clock.set(at(45));
    const commit = vi.fn();

    await expect(
      coordinator.commitPreparedTransition(
        {
          channelId: CHANNEL_ID,
          cursor: { kind: "filler", endsAt: at(60) },
          scheduleRevision: (await readOnlyScheduleState(db)).schedule_revision,
        },
        commit,
      ),
    ).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
  });

  it("reports a filler preparation stale after a reservation edit moves its end", async () => {
    const { coordinator, clock, db, server, reservationUrl } =
      await reservedAtSixty();
    const prepared = {
      channelId: CHANNEL_ID,
      cursor: { kind: "filler" as const, endsAt: at(60) },
      scheduleRevision: (await readOnlyScheduleState(db)).schedule_revision,
    };
    // The worker prepared the filler; then the owner moved the movie to 75.
    await saveReservation(server, "PATCH", reservationUrl, {
      startsAt: iso(at(75)),
      source: { kind: "media_items", mediaItemIds: ["movies-1"] },
    });
    clock.set(at(45));
    const commit = vi.fn();

    await expect(
      coordinator.commitPreparedTransition(prepared, commit),
    ).resolves.toBe("stale");
    // Even under the new revision, no filler ends at 60 any more.
    await expect(
      coordinator.commitPreparedTransition(
        {
          ...prepared,
          scheduleRevision: (await readOnlyScheduleState(db)).schedule_revision,
        },
        commit,
      ),
    ).resolves.toBe("stale");
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("planned filler in playout reads", () => {
  it("lists filler in timeline windows that start and end inside it, from the program before it", async () => {
    const { dependencies } = await reservedAtSixty();
    const log = recordingLog();

    const startsInside = await dependencies.playout.getTimeline(
      CHANNEL_ID,
      at(50),
      at(70),
      log,
    );
    const endsInside = await dependencies.playout.getTimeline(
      CHANNEL_ID,
      at(30),
      at(50),
      log,
    );

    expect(startsInside).toMatchObject({
      items: [
        { type: "filler", startsAt: at(45), endsAt: at(60) },
        { type: "program", mediaItemId: "movies-1" },
      ],
    });
    expect(endsInside).toMatchObject({
      items: [
        { type: "program", endsAt: at(45) },
        { type: "filler", startsAt: at(45), endsAt: at(60) },
      ],
    });
  });

  it("walks several items through filler and reports a filler cursor no filler ends at as stale", async () => {
    const { dependencies, db } = await reservedAtSixty();
    const log = recordingLog();
    const first = (await readScheduleEntries(db, CHANNEL_ID))[0];

    const chain = await dependencies.playout.getFollowing(
      CHANNEL_ID,
      { kind: "program", scheduleEntryId: first?.id ?? "" },
      3,
      log,
    );
    const stale = await dependencies.playout.getFollowing(
      CHANNEL_ID,
      { kind: "filler", endsAt: at(55) },
      1,
      log,
    );

    expect(chain).toMatchObject({
      status: "selected",
      items: [
        { type: "program", startsAt: at(22) },
        { type: "filler", startsAt: at(45), endsAt: at(60) },
        { type: "program", mediaItemId: "movies-1" },
      ],
    });
    expect(stale).toMatchObject({ status: "stale_entry", items: [] });
  });
});

describe("planned filler in guide output", () => {
  it("lists filler apart from schedule entries, with its resume time, and never as an XMLTV programme", async () => {
    const { server } = await reservedAtSixty();

    const window = await send(
      server,
      "GET",
      windowUrl(`/channels/${CHANNEL_ID}/schedule`, at(30), at(70)),
    );
    const guide = await server.inject("/plex/xmltv.xml");

    // The scenario server evaluates in UTC, so programming resumes at 1:00 AM.
    expect(window.body.fillerIntervals).toEqual([
      { startsAt: iso(at(45)), endsAt: iso(at(60)), resumeTime: "1:00 AM" },
    ]);
    expect(
      (window.body.entries as { startsAt: string }[]).map(
        (entry) => entry.startsAt,
      ),
    ).toEqual([iso(at(22)), iso(at(60))]);
    const programmes = readGuideProgrammes(guide.body);
    expect(
      programmes.some(({ start }) => start === xmltvTimestamp(at(45))),
    ).toBe(false);
    // The movie follows the second episode directly: nothing fills 45-60.
    expect(programmes.slice(0, 3).map(({ start }) => start)).toEqual(
      [0, 22, 60].map((minutes) => xmltvTimestamp(at(minutes))),
    );
  });

  it("words filler's resume time on the now route", async () => {
    const { server } = await reservedAtSixty();

    const now = await send(
      server,
      "GET",
      `/channels/${CHANNEL_ID}/now?at=${iso(at(50))}`,
    );

    expect(now.body.currentItem).toMatchObject({
      type: "filler",
      resumeTime: "1:00 AM",
    });
  });
});
